# Escreva o seu próprio plugin

O modo criação transforma uma frase num plugin. Diz o que deve mudar, uma IA escreve o plugin e o Voyager verifica-o antes de o importar. O modo criação fica no cartão **Minhas criações** do popup do Voyager, e o que cria é um plugin local.

Um plugin local é um plugin que cria para si. Altera o aspeto ou a disposição do Gemini, AI Studio, ChatGPT, Claude, DeepSeek ou Kimi, vive apenas no seu navegador e não precisa de nenhuma pull request nem de uma cópia do código-fonte do Voyager.

Como todos os plugins do Voyager, é declarativo: um manifest `plugin.json` mais CSS. Não executa código próprio. O Voyager verifica-o ao importar, aplica as alterações e remove-as todas quando o desativa. Um plugin importado começa desativado, para que o possa rever primeiro.

## Três formas de o criar

As três formas terminam em **Minhas criações**. No Gemini e no AI Studio é um cartão das definições, logo abaixo de **Sincronização na Nuvem** se não o mudar de lugar, e **Ir para**, no topo do popup, leva até ele. No ChatGPT, Claude, DeepSeek e Kimi fica por baixo da lista de plugins. **Crie o seu**, no fim da lista de plugins, leva-o ao primeiro campo do cartão.

As duas primeiras formas partem de uma frase. Escreva-a em **O que deve mudar?** («Torna as minhas mensagens mais estreitas e esconde a barra lateral»). O campo **Site** por baixo começa com o site do separador atual; mude-o se o plugin for para outro site.

### Copiar para este chat

1. Escolha **Copiar para este chat** e cole a mensagem no chat de IA desse site.
2. A IA lê a página do Voyager para o site, como `https://voyager.nagi.fun/create/claude.md`, e responde com um único bloco de código JSON. A IA tem de conseguir abrir links.
3. Cole a resposta completa em **Cole a resposta da IA** e escolha **Verificar resposta**.
4. O Voyager mostra em linguagem simples o que o plugin altera. Escolha **Importar** e ative-o na lista de plugins. No Gemini e no AI Studio, o interruptor aparece logo abaixo do cartão.

O Voyager não envia nada por si. É o utilizador que cola a mensagem e traz a resposta de volta.

### Copiar para um agente local

Se usa um agente de programação (Claude Code, Codex, Cursor e semelhantes), escolha **Copiar para um agente local** e entregue o texto ao agente. O texto pede-lhe que siga a skill de plugins do Voyager:

```text
https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md
```

A skill contém o contrato completo: os campos do manifest, o que cada site declara, as primitivas e o que um plugin não pode fazer. O agente escreve `plugin.json` e `style.css`, corre `npx create-voyager-plugin@latest check` até passarem e devolve os dois ficheiros. Em **Minhas criações**, abra **Outras formas de adicionar**, escolha **Importar arquivos** e selecione os dois ficheiros.

Para manter a skill instalada, guarde o ficheiro como `write-voyager-plugin/SKILL.md` na pasta de skills do seu agente (no Claude Code, `~/.claude/skills/`).

### Escreva-o à mão

Com Node.js 18 ou mais recente:

```sh
npx create-voyager-plugin@latest init my-plugin --site claude
# edite my-plugin/plugin.json e my-plugin/style.css
npx create-voyager-plugin@latest check my-plugin
```

`init` gera um `plugin.json` e um `style.css` que já passam nas verificações, além de um `AGENTS.md` com as regras desse site. `--site` aceita `gemini`, `aistudio`, `chatgpt`, `claude`, `deepseek` ou `kimi`.

`check` executa offline as mesmas verificações que a importação do popup. Termina com o código 0 quando o plugin pode ser importado e, caso contrário, imprime uma linha `path: message` por problema. Acrescente `--json` para obter uma saída legível por máquina.

Quando passar, importe os dois ficheiros da mesma forma, com **Importar arquivos** em **Outras formas de adicionar**.

## O que um plugin pode fazer

- Acrescentar CSS, limitado a uma classe `gv-` que o plugin adiciona à página.
- Adicionar uma classe, definir um atributo seguro ou um estilo inline, ou esconder elementos. Os alvos são chaves semânticas que o site declara (`userTurn`, `assistantTurn`, `composer`, …) ou seletores CSS.
- Oferecer definições no popup: interruptores, controlos deslizantes e listas pendentes, cujos valores chegam ao CSS através de tokens `{{key}}`.
- No ChatGPT, Claude, DeepSeek e Kimi, ativar uma primitiva do Voyager (cópia de fórmulas, a linha do tempo, diagramas Mermaid e outras) e mudar as cores da própria interface do Voyager.

## O que não pode fazer

Um plugin não pode executar JavaScript, reagir a cliques ou teclas, carregar nada da rede (tipos de letra, imagens, folhas de estilo), ler ou reescrever o que uma mensagem diz, nem correr noutros sites. Se um pedido precisar de alguma destas coisas, o material de autoria diz à IA para o dizer claramente e para construir a versão mais próxima que funcione.

## Regras verificadas na importação

Além das verificações comuns do manifest (veja [Contribuir plugins](./plugin-contribution.md)), um plugin local tem de:

- corresponder apenas a URL dentro de um site suportado pelo Voyager;
- usar apenas chaves semânticas declaradas por todos os sites a que corresponde;
- adicionar exatamente uma classe por `addClass`, começada por `gv-`;
- usar definições boolean, number ou select (string e color ainda não têm controlo no popup);
- não usar `theme` no Gemini nem no AI Studio, e usar apenas as primitivas que cada site permite: `formulaCopy`, `vimInput`, `userLatex`, `codeCollapse`, `mermaid`, `wavedrom` e `echarts`, `sendShortcut`, `draftSave`, `turnNavigator` no Gemini, `formulaCopy` e `sendShortcut` no AI Studio. Elas executam o mesmo código das configurações próprias do Voyager. `formulaCopy` e `vimInput` (copiar fórmulas e modo Vim da caixa de entrada) rodam uma só vez por página: a configuração integrada ou um plugin, não os dois. Ao carregar a página, ou enquanto nenhum dos dois estiver rodando, a configuração integrada vem primeiro; depois disso, o que já está rodando continua e o outro aparece em pausa. Desative um para que o outro assuma. `userLatex`, `codeCollapse`, `mermaid`, `wavedrom` e `echarts` assumem a página elemento por elemento e rodam junto com a configuração integrada: uma linha ou bloco de código que o outro já tem fica com ele.

No Gemini para utilizadores individuais, o `turnNavigator` local já está disponível com `params.dataBackend: "shared"` e `engine: ">=1.9.0"`. Lê e altera os mesmos dados nativos de estrelas e hierarquia da linha do tempo oficial; não é possível redefinir os parâmetros de identidade da conversa, da conta ou dos turnos. A opção oficial **Mostrar linha do tempo** entra em conflito com ele: desative-a antes de ativar o plugin local. Para voltar à linha do tempo oficial, desative primeiro o plugin local e depois ative a opção. Business, Enterprise e a cobertura personalizada de sites não são suportados.

As traduções (`i18n`) são opcionais.

## Partilhá-lo

Um plugin local fica no seu navegador. Para o levar para outro lado, escolha **Exportar** nele na lista de **Minhas criações** e depois importe lá o ficheiro JSON. Se puder ser útil a todos, proponha-o para o catálogo oficial: [Contribuir plugins](./plugin-contribution.md) descreve esse caminho.

Em todos os sites, apenas um plugin de atalho de envio funciona por página. Enquanto um plugin ocupa o modo de envio, outro indica um conflito e fica em pausa. O parâmetro opcional `mode` (requer `"engine": ">=1.9.0"`) é `ctrlEnterSends` (padrão) ou `enterSends`. Confirmar o IME não envia a mensagem. Gemini e AI Studio já permitem o uso; os modos aceitos estão abaixo.

No Gemini, `sendShortcut` pode substituir o envio oficial Ctrl/Cmd+Enter: desative essa opção e ative o plugin local. Apenas `ctrlEnterSends` é aceito; Enterprise permanece inativo. `composerRoot` inclui a entrada principal e a de edição; `sendButton` exclui Parar.

No AI Studio, `sendShortcut` exige `params.mode: "enterSends"`. Desative o envio oficial com Enter para que o plugin local assuma. Ctrl/Cmd+Enter insere uma nova linha; Shift/Alt+Enter fica com o site.

No Gemini, `draftSave` compartilha os registros oficiais `gvDraft_<pathname completo>`, incluindo `/u/N` e rotas Gem. Desativar preserva os rascunhos salvos; vários plugins da página podem compartilhá-los. Antes de fechar, tenta salvar a última entrada, mas o fechamento do navegador não garante a conclusão do armazenamento assíncrono. As gravações e a limpeza são coordenadas apenas nesta página; mudar o e-mail na mesma posição `/u/N` mantém o compartilhamento dos rascunhos salvos.
