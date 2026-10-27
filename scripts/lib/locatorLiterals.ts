import ts from 'typescript';

const HOLE = '\uE000';

export interface LocatorLiteral {
  readonly node: ts.Node;
  readonly text: string;
  readonly parts: readonly string[];
}

/** CSS comments outside quotes do not change the host name seen by querySelector. */
function withoutComments(value: string): string {
  let output = '';
  let quote = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\') {
      output += value.slice(index, index + 2);
      index++;
    } else if (quote) {
      output += char;
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
      output += char;
    } else if (char === '/' && value[index + 1] === '*') {
      const end = value.indexOf('*/', index + 2);
      if (end < 0) break;
      index = end + 1;
    } else output += char;
  }
  return output;
}

/** Keep quoted attribute values and functional selectors intact at combinators. */
function splitSelectors(value: string, separator: RegExp): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\') {
      index++;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '[' || char === '(') depth++;
    else if (char === ']' || char === ')') depth--;
    else if (!depth && separator.test(char)) {
      if (index > start) result.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (start < value.length) result.push(value.slice(start));
  return result.map((part) => part.trim()).filter(Boolean);
}

function compounds(value: string): string[] {
  return splitSelectors(value, /[\s,>+~|]/);
}

/** Each list member is an independently usable published locator. */
export function selectorListMembers(value: string): string[] {
  return splitSelectors(value, /,/);
}

function balancedEnd(value: string, start: number): number {
  const close = value[start] === '[' ? ']' : ')';
  let quote = '';
  for (let index = start + 1; index < value.length; index++) {
    const char = value[index];
    if (char === '\\') index++;
    else if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '[' || char === '(') index = balancedEnd(value, index) - 1;
    else if (char === close) return index + 1;
  }
  return value.length;
}

/** Equivalent CSS attribute quotes and HTML type casing identify the same locator. */
export function canonicalLocator(value: string): string {
  let result = '';
  for (let index = 0; index < value.length;) {
    const char = value[index];
    if (char === '[') {
      const end = balancedEnd(value, index);
      const attribute = value.slice(index, end);
      const match = attribute.match(
        /^\[\s*([\w:-]+)\s*([~|^$*]?=)\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s\]]+))\s*([is])?\s*\]$/i,
      );
      result += match
        ? `[${match[1].toLowerCase()}${match[2]}${JSON.stringify(match[3] ?? match[4] ?? match[5])}${match[6] ? ` ${match[6].toLowerCase()}` : ''}]`
        : attribute;
      index = end;
    } else if (char === '\\') {
      result += value.slice(index, index + 2);
      index += 2;
    } else {
      const name = value.slice(index).match(/^[\w\-\uE000]+/)?.[0];
      if (name) {
        const prefix = value[index - 1];
        result += prefix === '.' || prefix === '#' || prefix === ':' ? name : name.toLowerCase();
        index += name.length;
      } else {
        result += char;
        index++;
      }
    }
  }
  return result;
}

/** A compound can embed a published class, attribute or tag beside extra constraints. */
export function selectorLiteralParts(value: string): string[] {
  value = canonicalLocator(withoutComments(value));
  const result = new Set([value]);
  for (const compound of compounds(value)) {
    result.add(compound);
    let index = 0;
    while (index < compound.length) {
      const start = index;
      const char = compound[index];
      if (char === '[') index = balancedEnd(compound, index);
      else {
        if (char === '.' || char === '#' || char === ':') {
          index++;
          if (compound[index] === ':') index++;
        }
        const name = compound.slice(index).match(/^(?:[\w\-\uE000]|\\.)+/)?.[0];
        if (!name && compound[index] !== '*') break;
        index += name?.length ?? 1;
        if (compound[index] === '(') {
          const end = balancedEnd(compound, index);
          for (const part of selectorLiteralParts(compound.slice(index + 1, end - 1)))
            result.add(part);
          index = end;
        }
      }
      result.add(compound.slice(start, index));
    }
  }
  return [...result].filter(Boolean);
}

function stringPattern(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  )
    return stringPattern(node.expression);
  if (ts.isTemplateExpression(node))
    return (
      node.head.text +
      node.templateSpans
        .map((span) => (stringPattern(span.expression) ?? HOLE) + span.literal.text)
        .join('')
    );
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = stringPattern(node.left);
    const right = stringPattern(node.right);
    return left !== null || right !== null ? (left ?? HOLE) + (right ?? HOLE) : null;
  }
  return null;
}

/** Visit a concatenation once, after folding its string-only operands. */
export function locatorLiterals(source: ts.SourceFile): LocatorLiteral[] {
  const literals: LocatorLiteral[] = [];
  function visit(node: ts.Node): void {
    const pattern = stringPattern(node);
    if (pattern !== null) {
      const staticParts = pattern.split(HOLE);
      literals.push({
        node,
        text: pattern.replaceAll(HOLE, '${…}'),
        parts: [...selectorLiteralParts(pattern), ...staticParts.flatMap(selectorLiteralParts)],
      });
      // Interpolated expressions may themselves contain literal bypasses.
      function embedded(expression: ts.Node): void {
        if (stringPattern(expression) === null) visit(expression);
        else if (ts.isTemplateExpression(expression))
          for (const span of expression.templateSpans) embedded(span.expression);
        else if (ts.isBinaryExpression(expression)) {
          embedded(expression.left);
          embedded(expression.right);
        } else if (
          ts.isParenthesizedExpression(expression) ||
          ts.isAsExpression(expression) ||
          ts.isSatisfiesExpression(expression) ||
          ts.isNonNullExpression(expression)
        )
          embedded(expression.expression);
      }
      if (ts.isTemplateExpression(node))
        for (const span of node.templateSpans) embedded(span.expression);
      else if (ts.isBinaryExpression(node)) {
        embedded(node.left);
        embedded(node.right);
      } else if (
        ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isNonNullExpression(node)
      )
        embedded(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return literals;
}

export function matchedPublishedLocators(
  literal: LocatorLiteral,
  published: ReadonlyMap<string, readonly string[]>,
): string[] {
  const matches = new Set<string>();
  for (const part of literal.parts) {
    if (published.has(part)) matches.add(part);
    // Punctuation-only interpolation (IDs, timestamps, CSS values) proves no host name.
    if (
      !part.includes(HOLE) ||
      part.startsWith(HOLE) ||
      compounds(part).length !== 1 ||
      !/[a-zA-Z][\w-]+/.test(part.replaceAll(HOLE, ''))
    )
      continue;
    const pattern = new RegExp(
      `^${part
        .split(HOLE)
        .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`,
    );
    for (const value of published.keys())
      if (compounds(value).length === 1 && pattern.test(value)) matches.add(value);
  }
  return [...matches];
}
