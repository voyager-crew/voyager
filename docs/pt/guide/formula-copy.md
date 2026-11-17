# Cópia de Fórmulas

O Voyager torna fácil a reutilização de fórmulas matemáticas e símbolos científicos. Clique numa fórmula para a copiar como LaTeX, MathML pronto para o Word ou um bloco compatível com o Notion.

## Introdução

Quando pede ao Gemini para derivar fórmulas ou escrever expressões matemáticas, ele geralmente apresenta-as usando LaTeX. Embora seja visualmente atraente, extrair o código-fonte para usar nos seus próprios artigos, documentos ou editores exige frequentemente um esforço manual.

O Voyager oferece suporte total para isso:

1. **Deteção Automática**: O Voyager identifica automaticamente as fórmulas apresentadas na página. Ao passar o rato sobre uma, percebe que é clicável.
2. **Clique para Copiar**: Clique numa fórmula inline ou em bloco e ela é copiada de imediato, com uma breve confirmação.
3. **Opções de Formato**: No popup, ative **Conteúdo das respostas** → **Cópia de fórmulas** e escolha o formato de cópia abaixo da linha:
   - **LaTeX**: Código-fonte LaTeX padrão com delimitadores de cifrão, ideal para Overleaf, editores Markdown, etc.
   - **LaTeX (Sem cifrão)**: O código-fonte LaTeX puro, para editores que adicionam os seus próprios delimitadores.
   - **MathML (Word)**: O melhor formato para colar diretamente no **Microsoft Word**.
   - **Notion ($$ Formato)**: Envolve cada fórmula em `$$`, que o Notion transforma numa equação.

![Cópia de Fórmulas](/assets/gemini-math-copy.png)

## Características

- **Compatibilidade com Word**: Com o suporte MathML, pode colar fórmulas complexas geradas por IA diretamente em documentos Word, mantendo um formato editável perfeito.
- **Preservação do Contexto**: Não copia apenas a fórmula em si, mas também preserva o seu contexto matemático.
- **Resposta Instantânea**: Processado inteiramente de forma local para resultados imediatos.

## Dicas de Utilização

- **Escrita Académica**: Ao escrever artigos no Word, peça ao Gemini para derivar fórmulas e, em seguida, utilize a cópia MathML para evitar o trabalho de introdução manual no Editor de Equações do Word.
- **Notas**: Ao tirar notas no Obsidian ou Notion, basta copiar a fonte LaTeX diretamente.

## Onde funciona

No Gemini e no AI Studio, ative com **Conteúdo das respostas** → **Cópia de fórmulas** no popup; o formato de cópia aparece abaixo dessa linha quando ela está ativada. Essa opção e o formato de cópia valem para os dois sites. No Claude, ChatGPT, DeepSeek e Grok, a cópia de fórmulas é um plugin: abra o popup nesse site e ative **Cópia de fórmulas** no cartão **Plugins**. Os plugins de cada site estão em [Todos os plugins](/pt/guide/plugins).
