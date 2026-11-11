import { act } from 'react';

export const AUTHORED = {
  id: 'me.narrow',
  name: 'Narrow messages',
  version: '1.0.0',
  description: 'Narrower user messages on Claude',
  author: 'Me',
  category: 'layout',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://claude.ai/*'],
  contributes: {
    styles: [{ css: '.gv-plugin-narrow{max-width:640px}' }],
    domOps: [
      {
        op: 'addClass',
        target: { kind: 'semantic', key: 'userTurn' },
        className: 'gv-plugin-narrow',
      },
    ],
  },
};

export const fenced = (value: unknown) =>
  `Sure! Here is your plugin:\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n\nEnable it in Voyager.`;

export function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

export function field(container: HTMLElement, placeholder: string): HTMLTextAreaElement {
  const found = container.querySelector<HTMLTextAreaElement>(
    `textarea[placeholder="${placeholder}"]`,
  );
  if (!found) throw new Error(`no field ${placeholder}`);
  return found;
}

export function setValue(element: HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? 'change' : 'input', {
      bubbles: true,
    }),
  );
}

export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
