# O Seu Ativo Digital: Biblioteca de Prompts

Passou algum tempo a criar um Prompt divino que ajudou imenso.
Usar e deitar fora?
Não, guarde-o.

## Cofre de Comandos

Este é o seu cofre de comandos.

### 1. Capturar

Escreveu algo bom? Clique na **bola flutuante do Voyager** (por padrão fica ao lado da caixa de entrada, e pode arrastá-la para onde quiser) para abrir o Gestor de Prompts.
Guarde no cofre, sinta-se seguro.

### 2. Categorizar

Adicione etiquetas como `código`, `email`, `académico` (separadas por vírgulas).
As ferramentas devem ser úteis e também organizadas.

### 3. Implementar

Da próxima vez que precisar, não escreva tudo de novo.
Abra a biblioteca, pesquise por etiqueta, clique para inserir.
Chamada num clique, duplique a eficiência.

![Gestor de Prompts](/assets/gemini-prompt-manager.png)

## Lista compacta & notas

Quando os prompts se acumulam e a lista de cartões não cabe mais, o painel se adapta:

### Alternar visualização

O botão `≡ / ▦` à direita da barra de pesquisa alterna entre **Lista compacta** (padrão) e **Visão confortável**.

- **Lista compacta**: um prompt por linha, ~10 visíveis de uma vez. À direita: tags · expandir · editar · excluir
- **Visão confortável**: preview completo de Markdown, ideal para coleções pequenas

### Nome obrigatório

O campo **Nome** no topo do formulário é obrigatório ao adicionar ou editar um prompt. Prompts antigos sem nome são preservados, mas precisarão de um nome na próxima edição.

### Preview rápido ao passar o mouse

No modo compacto, passe o mouse sobre qualquer linha por **~250 ms** para ver o conteúdo completo em um tooltip flutuante — substitui o tooltip nativo `title` do navegador (que pode demorar 1–3 s para aparecer).

### Inserção rápida com barra

Na caixa de conversa, digite `/` seguido de parte do nome de um prompt. A lista mostra os nomes e tags correspondentes, seguidos de **Gerenciar prompts…** e **Painel do Voyager…**, que abrem o Gestor de prompts e o [painel do Voyager](/pt/guide/panel); passe o mouse sobre um item para ver o conteúdo completo e selecione-o com o botão esquerdo ou com `Tab` / `Enter`. O nome aparece como um token destacado e, ao enviar, o corpo completo do prompt é usado.

![Visualização em lista compacta](/assets/gemini-prompt-manager-compact.png)

## Exportar, importar e migrar

Sua biblioteca de prompts pode ser salva como um arquivo JSON local ou mesclada com o Google Drive, para levá-la a outra conta Google ou outro navegador.

No Gemini e no AI Studio, abra o popup do Voyager e encontre **Dados de prompts** no cartão **Gerenciador de Prompts**. No Claude, ChatGPT, DeepSeek, Kimi e Grok, **Dados de prompts** é um cartão próprio no popup, acima do cartão **Plugins**.

- **Exportar**: salva a biblioteca inteira em um único arquivo JSON.
- **Importar**: mescla um arquivo JSON à sua biblioteca. Nada do que você já tem é apagado; um prompt que já existe fica uma só vez, com as tags combinadas.
- **Baixar (mesclar) / Enviar (mesclar)**: mescla seus prompts com os do Google Drive. Veja [Sincronização na nuvem](/pt/guide/cloud-sync) para conectar o Drive.
- **Migrar**: clique em **Exportar** no perfil antigo do navegador e depois **Importe** o arquivo no perfil da sua outra conta Google ou em outro computador.

Prompts com nomes duplicados são todos mantidos, mas precisam de outro nome antes de poder usar a inserção rápida `/`.

## Funciona em Qualquer Site

O Gestor de Prompts agora pode ser usado em qualquer site à sua escolha, não limitado ao Gemini™ e AI Studio.

### Como Ativar

No Claude, no ChatGPT, no DeepSeek, no Kimi e no Grok, o Gerenciador de Prompts é uma linha do cartão **Plugins** do site. Abra o popup do Voyager enquanto estiver no site e ative **Gerenciador de Prompts**. Se for o primeiro recurso que você ativa ali, o navegador pede acesso ao site uma única vez.

Para qualquer outro site:

1. Clique no ícone do Voyager na barra de ferramentas de extensões do navegador.
2. No cartão **Acesso a sites**, vá até **Outros sites**.
3. Introduza o endereço do site (ex: `poe.com`).
4. Clique em **Adicionar site** e conceda permissão.
5. **Atualize a página de destino**, e verá a bola flutuante.

### Exemplos de Sites de IA Comuns

- `copilot.microsoft.com` - Microsoft Copilot
- `poe.com` - Poe

### Aplicativos locais

Endereços locais também funcionam — digite `localhost:3080` ou `127.0.0.1:3080` da mesma maneira. Por exemplo, o [DeepSeek Harness](/pt/guide/deepseek-harness) roda em `localhost:3080`, e o Gestor de Prompts se acopla como em qualquer site.

![Gestor de Prompts dentro do DeepSeek Harness](/assets/prompt-manager-deepseek-harness.png)

::: tip
Em sites personalizados, **apenas** a funcionalidade de Gestor de Prompts é ativada. Outras funcionalidades como Linha do Tempo, Pastas, etc., não são carregadas ali. Claude, ChatGPT, DeepSeek, Kimi e Grok são diferentes: recebem plugins oficiais próprios, que pode conferir na [lista de plugins](/pt/guide/plugins).
:::
