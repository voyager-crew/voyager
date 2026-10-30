import { describe, expect, it } from 'vitest';

import { isGenericLanguageLabel } from '../../codeBlock';
import { isMermaidCode, normalizeMermaidCode, normalizeWhitespace } from '../source';

describe('Mermaid source compatibility', () => {
  describe('Firefox Mermaid compatibility', () => {
    it('parses representative model output with Mermaid 9.2.2 in strict mode', async () => {
      const mermaidLegacy = (await import('mermaid-legacy')).default;
      mermaidLegacy.initialize({ startOnLoad: false, securityLevel: 'strict' });

      const source = normalizeMermaidCode(`sequenceDiagram
        participant 用户
        participant 系统
        用户->>系统: SSH 登录并检查日志
        系统-->>用户: 服务恢复正常`);

      expect(mermaidLegacy.parse(source)).toBe(true);
    });
  });

  describe('isMermaidCode', () => {
    it('should detect flowchart syntax', () => {
      const code = `flowchart TD
        A[Start] --> B{Is it working?}
        B -- Yes --> C[Great!]
        B -- No --> D[Fix it]
        D --> B`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect graph syntax', () => {
      const code = `graph LR
        A[Start] --> B[Process]
        B --> C[End]
        C --> D[Done]`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect sequenceDiagram syntax', () => {
      const code = `sequenceDiagram
        participant Alice
        participant Bob
        Alice->>Bob: Hello Bob
        Bob-->>Alice: Hi Alice`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect classDiagram syntax', () => {
      const code = `classDiagram
        class Animal {
          +String name
          +makeSound()
        }
        Animal <|-- Duck
        Animal <|-- Fish`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect erDiagram syntax', () => {
      const code = `erDiagram
        CUSTOMER ||--o{ ORDER : places
        ORDER ||--|{ LINE-ITEM : contains
        CUSTOMER }|..|{ DELIVERY-ADDRESS : uses`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect gantt syntax', () => {
      const code = `gantt
        title A Gantt Diagram
        dateFormat  YYYY-MM-DD
        section Section
        A task           :a1, 2024-01-01, 30d`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect pie chart syntax', () => {
      const code = `pie title Pets adopted by volunteers
        "Dogs" : 386
        "Cats" : 85
        "Rats" : 15
        "Others" : 35`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect gitGraph syntax', () => {
      const code = `gitGraph
        commit
        branch develop
        checkout develop
        commit
        checkout main
        merge develop`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect mermaid comment prefix (%%)', () => {
      const code = `%% This is a mermaid diagram
        graph TD
        A --> B
        B --> C`;
      expect(isMermaidCode(code)).toBe(true);
    });

    // C4 diagrams
    it('should detect C4Context syntax', () => {
      const code = `C4Context
        title System Context diagram
        Person(customerA, "Customer A")
        System(systemA, "System A")
        Rel(customerA, systemA, "Uses")`;
      expect(isMermaidCode(code)).toBe(true);
    });

    // New v11 diagram types (both -beta and non-beta forms)
    it('should detect xychart-beta syntax', () => {
      const code = `xychart-beta
        title "Sales Revenue"
        x-axis [jan, feb, mar, apr]
        y-axis "Revenue (in $)" 4000 --> 11000
        bar [5000, 6000, 7500, 8200]`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect xychart syntax (without -beta)', () => {
      const code = `xychart
        title "Sales Revenue"
        x-axis [jan, feb, mar, apr]
        y-axis "Revenue (in $)" 4000 --> 11000
        bar [5000, 6000, 7500, 8200]`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect block-beta syntax', () => {
      const code = `block-beta
        columns 3
        a["Block A"] b["Block B"] c["Block C"]
        d["Block D"]:3
        e["Block E"] f["Block F"]`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect block syntax (without -beta)', () => {
      const code = `block
        columns 3
        a["Block A"] b["Block B"] c["Block C"]
        d["Block D"]:3
        e["Block E"] f["Block F"]`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect packet-beta syntax', () => {
      const code = `packet-beta
        title TCP Header
        0-15: "Source Port"
        16-31: "Destination Port"
        32-63: "Sequence Number"`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect packet syntax (without -beta)', () => {
      const code = `packet
        title TCP Header
        0-15: "Source Port"
        16-31: "Destination Port"
        32-63: "Sequence Number"`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect architecture syntax', () => {
      const code = `architecture
        group api(cloud)[API]
        service db(database)[Database]
        service web(server)[Web Server]
        db:L -- R:web`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect kanban syntax', () => {
      const code = `kanban
        Todo
          id1[Task 1]
          id2[Task 2]
        "In Progress"
          id3[Task 3]`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect radar-beta syntax', () => {
      const code = `radar-beta
        title Skills Assessment
        axis1 "JavaScript"
        axis2 "TypeScript"
        axis3 "React"
        curve a: 5, 4, 3`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect treemap syntax', () => {
      const code = `treemap
        root("Project")
          src("Source")
            core("Core")
            features("Features")
          tests("Tests")`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect sankey syntax (without -beta)', () => {
      const code = `sankey
        Agricultural "ichael",Fossil fuels,17.5
        Biofuel imports,Liquid,35.8
        Biomass imports,Solid,15.5
        Coal imports,Coal,12.3`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should detect requirement syntax (without Diagram suffix)', () => {
      const code = `requirement
        functionalRequirement test_req {
          id: 1
          text: "The system shall do something"
          risk: high
        }`;
      expect(isMermaidCode(code)).toBe(true);
    });

    it('should reject code shorter than 50 chars', () => {
      expect(isMermaidCode('graph TD\n  A --> B')).toBe(false);
    });

    it('should reject code with fewer than 3 non-empty lines', () => {
      const code = `flowchart TD
        A[Start] --> B[End]`;
      expect(isMermaidCode(code)).toBe(false);
    });

    it('should reject code with incomplete endings', () => {
      const code = `flowchart TD
        A[Start] --> B{Decision}
        B -- Yes --> C[Process]
        C -->`;
      expect(isMermaidCode(code)).toBe(false);
    });

    it('should reject non-mermaid code', () => {
      const code = `function hello() {
        console.log("Hello World");
        return true;
        // some more code here to pass length check
      }`;
      expect(isMermaidCode(code)).toBe(false);
    });

    it('should be case-insensitive for keywords', () => {
      const code = `FLOWCHART TD
        A[Start] --> B[Process]
        B --> C[End]
        C --> D[Done]`;
      expect(isMermaidCode(code)).toBe(true);
    });
  });

  describe('normalizeWhitespace', () => {
    it('should replace non-breaking spaces with standard spaces', () => {
      const input = 'graph\u00A0TD\u00A0A-->B';
      expect(normalizeWhitespace(input)).toBe('graph TD A-->B');
    });

    it('should replace em spaces', () => {
      const input = 'graph\u2003TD';
      expect(normalizeWhitespace(input)).toBe('graph TD');
    });

    it('should replace en spaces', () => {
      const input = 'graph\u2002TD';
      expect(normalizeWhitespace(input)).toBe('graph TD');
    });

    it('should replace thin spaces', () => {
      const input = 'graph\u2009TD';
      expect(normalizeWhitespace(input)).toBe('graph TD');
    });

    it('should replace ideographic (CJK full-width) spaces', () => {
      const input = 'graph\u3000TD';
      expect(normalizeWhitespace(input)).toBe('graph TD');
    });

    it('should remove zero-width spaces', () => {
      const input = 'graph\u200BTD';
      expect(normalizeWhitespace(input)).toBe('graphTD');
    });

    it('should remove zero-width non-joiner', () => {
      const input = 'graph\u200CTD';
      expect(normalizeWhitespace(input)).toBe('graphTD');
    });

    it('should remove zero-width joiner', () => {
      const input = 'graph\u200DTD';
      expect(normalizeWhitespace(input)).toBe('graphTD');
    });

    it('should keep the joiner that holds an emoji sequence together', () => {
      // Stripping every U+200D splits these into their component glyphs, so a
      // node label like `A["\u{1F468}\u200D\u{1F469}\u200D\u{1F466} team"]`
      // would render as three separate people.
      const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F466}';
      expect(normalizeWhitespace(family)).toBe(family);

      // The flag sequence puts a variation selector between the emoji and the
      // joiner, so the lookback has to skip it.
      const flag = '\u{1F3F3}\uFE0F\u200D\u{1F308}';
      expect(normalizeWhitespace(flag)).toBe(flag);
    });

    it('should still remove a joiner that only touches an emoji on one side', () => {
      expect(normalizeWhitespace('a\u200D\u{1F44D}')).toBe('a\u{1F44D}');
      expect(normalizeWhitespace('\u{1F44D}\u200Db')).toBe('\u{1F44D}b');
    });

    it('should remove BOM character', () => {
      const input = '\uFEFFgraph TD';
      expect(normalizeWhitespace(input)).toBe('graph TD');
    });

    it('should handle mixed special whitespace', () => {
      const input = 'graph\u00A0TD\u200B\u2003A\u2009-->\u3000B';
      expect(normalizeWhitespace(input)).toBe('graph TD A --> B');
    });

    it('should leave standard whitespace unchanged', () => {
      const input = 'graph TD\n  A --> B\n  B --> C';
      expect(normalizeWhitespace(input)).toBe('graph TD\n  A --> B\n  B --> C');
    });
  });

  describe('normalizeMermaidCode', () => {
    it('converts simple HTML emphasis to Markdown for sanitized SVG labels', () => {
      const input = `flowchart TD
        A[<b>Prepare</b><br/>Dry portafilter]
        A --> B[<em>Dose &amp; extract</em>]`;

      expect(normalizeMermaidCode(input)).toBe(`flowchart TD
        A[**Prepare**<br/>Dry portafilter]
        A --> B[_Dose &amp; extract_]`);
    });

    it('moves a trailing comment after linkStyle onto its own line', () => {
      const input = `graph TD
        A --> B
        linkStyle 0 stroke:#FF5722,stroke-width:3px; %% emphasize the edge`;

      expect(normalizeMermaidCode(input)).toBe(`graph TD
        A --> B
        linkStyle 0 stroke:#FF5722,stroke-width:3px;
        %% emphasize the edge`);
    });

    it('handles trailing comments on other style directives', () => {
      const input = `graph TD
        classDef result fill:#C8E6C9; %% result style
        class A result; %% apply result style`;

      expect(normalizeMermaidCode(input)).toBe(`graph TD
        classDef result fill:#C8E6C9;
        %% result style
        class A result;
        %% apply result style`);
    });

    it('leaves standalone comments and diagram text unchanged', () => {
      const input = `graph TD
        %% standalone comment
        A[Progress %% complete] --> B`;

      expect(normalizeMermaidCode(input)).toBe(input);
    });

    it('quotes unquoted subgraph titles that contain parentheses', () => {
      const input = `graph LR
        subgraph 流量层 (日活十亿)
          A --> B
        end`;

      expect(normalizeMermaidCode(input)).toBe(`graph LR
        subgraph "流量层 (日活十亿)"
          A --> B
        end`);
    });

    it('leaves quoted and id-based subgraph titles unchanged', () => {
      const input = `graph LR
        subgraph "流量层 (日活十亿)"
        end
        subgraph traffic["流量层 (日活十亿)"]
        end`;

      expect(normalizeMermaidCode(input)).toBe(input);
    });

    it('repairs a translated empty activation when the participant is later deactivated', () => {
      const input = `sequenceDiagram
        participant 你
        激活->>你:
        你->>系统: 修复
        deactivate 你`;

      expect(normalizeMermaidCode(input)).toBe(`sequenceDiagram
        participant 你
        activate 你
        你->>系统: 修复
        deactivate 你`);
    });

    it('does not reinterpret a participant named 激活 or an unmatched empty message', () => {
      const input = `sequenceDiagram
        participant 激活
        participant 你
        激活->>你:
        你->>系统: 修复`;

      expect(normalizeMermaidCode(input)).toBe(input);
    });
  });

  describe('isGenericLanguageLabel', () => {
    it('should return true for null (no label)', () => {
      expect(isGenericLanguageLabel(null)).toBe(true);
    });

    it('should return true for generic English labels', () => {
      expect(isGenericLanguageLabel('code')).toBe(true);
      expect(isGenericLanguageLabel('text')).toBe(true);
      expect(isGenericLanguageLabel('plaintext')).toBe(true);
      expect(isGenericLanguageLabel('snippet')).toBe(true);
      expect(isGenericLanguageLabel('example')).toBe(true);
    });

    it('should return true for generic Chinese labels', () => {
      expect(isGenericLanguageLabel('代码段')).toBe(true);
      expect(isGenericLanguageLabel('代码')).toBe(true);
      expect(isGenericLanguageLabel('示例')).toBe(true);
    });

    it('should return true for generic Traditional Chinese labels', () => {
      expect(isGenericLanguageLabel('程式碼片段')).toBe(true);
    });

    it('should return true for generic Japanese labels', () => {
      expect(isGenericLanguageLabel('コード スニペット')).toBe(true);
    });

    it('should return true for the remaining verified Gemini localized labels', () => {
      const labels = [
        'مقتطف الرمز',
        'Fragmento de código',
        'Extrait de code',
        '코드 스니펫',
        'Snippet de código',
        'Фрагмент кода',
      ];

      labels.forEach((label) => {
        expect(isGenericLanguageLabel(label)).toBe(true);
      });
    });

    it('should return false for specific programming languages', () => {
      expect(isGenericLanguageLabel('python')).toBe(false);
      expect(isGenericLanguageLabel('javascript')).toBe(false);
      expect(isGenericLanguageLabel('typescript')).toBe(false);
      expect(isGenericLanguageLabel('rust')).toBe(false);
      expect(isGenericLanguageLabel('matlab')).toBe(false);
    });

    it('should return true for "mermaid" as it is in the generic set... wait no', () => {
      // "mermaid" is NOT in the generic set — it's handled separately in processCodeBlocks
      expect(isGenericLanguageLabel('mermaid')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isGenericLanguageLabel('Code')).toBe(true);
      expect(isGenericLanguageLabel('TEXT')).toBe(true);
      expect(isGenericLanguageLabel('Plaintext')).toBe(true);
    });
  });
});
