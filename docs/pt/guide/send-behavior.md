# Comportamento de Envio

::: info
**Nota**: Esta funcionalidade está disponível na versão 1.3.7 e posteriores.
:::

Altere o atalho de envio para `Ctrl+Enter` (`⌘+Enter` no macOS), transformando `Enter` numa tecla de nova linha para que possa compor prompts de várias linhas com tranquilidade.

## Porquê esta funcionalidade

Por defeito, pressionar `Enter` envia a mensagem imediatamente. Ao escrever prompts mais longos, colar código de várias linhas ou formatar cuidadosamente a sua entrada, isto frequentemente leva a envios acidentais — só queria uma nova linha, mas a mensagem já foi enviada.

Quando ativado:

- **Enter** → Inserir nova linha
- **Ctrl+Enter** (macOS: **⌘+Enter**) → Enviar mensagem

Shift+Enter e a composição de IME mantêm o comportamento próprio do site, e Ctrl/⌘+Enter aguarda enquanto um anexo ainda está a ser carregado.

## Como ativar

1. Abra o popup do Voyager.
2. Ative **Entrada** → **Ctrl/Cmd+Enter para enviar**.

## Outros sites

- **AI Studio** funciona ao contrário: ative **Enter para enviar no AI Studio** para enviar com `Enter` e adicionar uma nova linha com `Ctrl/⌘+Enter`.
- **Claude, ChatGPT, DeepSeek, Kimi e Grok**: abra o popup do Voyager nesse site e ative **Enviar com Ctrl/⌘+Enter** no cartão **Plugins**. Os plugins de cada site estão em [Todos os plugins](/pt/guide/plugins).
- **Safari**: se o Gemini exigir apertar Enter duas vezes para enviar, ative **Corrigir tecla Enter no Safari**.

## Características

- **Zero sobrecarga de desempenho**: Quando desativado, nenhum listener de eventos de teclado está ativo — sem impacto no desempenho da página.
- **Alternância instantânea**: As alterações entram em vigor imediatamente após ativar nas definições, sem necessidade de atualizar a página.
