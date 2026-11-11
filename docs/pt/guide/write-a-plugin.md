# Escreva o seu próprio plugin

O modo criação transforma uma frase num plugin. Diz o que deve mudar, uma IA escreve o plugin e o Voyager verifica-o antes de o importar. O modo criação fica no separador **Criar** do painel do Voyager e no cartão **Minhas criações** do popup do Voyager, e o que cria é um plugin local.

Um plugin local é um plugin que cria para si. Altera o aspeto ou a disposição do Gemini, AI Studio, ChatGPT, Claude, DeepSeek ou Kimi, vive apenas no seu navegador e não precisa de nenhuma pull request nem de uma cópia do código-fonte do Voyager.

A maioria das criações é declarativa: um manifest `plugin.json` mais CSS, sem código próprio. O Voyager verifica-o ao importar, aplica as alterações e remove-as todas quando o desativa. Um plugin importado começa desativado, para que o possa rever primeiro. Quando um pedido precisa de código, a IA pode escrever em vez disso uma criação que executa código, descrita abaixo.

## Criar na página

A forma mais rápida funciona no site de IA a que o plugin se destina. Abra aí o [painel do Voyager](./panel.md) e escolha **Criar**.

1. Escreva uma frase em **O que deve mudar?** e escolha **Criar nesta página**.
2. O Voyager abre um chat novo nesse site e põe o pedido na caixa de mensagem. Leia-o e envie-o você: o Voyager nunca carrega em enviar. Se a caixa de mensagem já tiver texto, o Voyager não lhe toca e avisa.
3. A IA lê a página do Voyager para o site e responde com um único bloco de código JSON. Por baixo do bloco, o Voyager acrescenta **Revisar e instalar**.
4. Escolha-o. O painel abre numa revisão: os sites onde o plugin funciona, cada alteração, o CSS completo e o que convém verificar primeiro. Escolha **Instalar e ativar** e aplica-se de imediato.

Para alterar o plugin, diga-o à IA no mesmo chat. Por baixo da nova resposta, o Voyager oferece **Revisar atualização**, e o bloco anterior indica **Versão anterior**. Quando o Voyager não consegue instalar uma resposta, oferece em vez disso **Devolver os problemas para a IA**: os problemas vão para a caixa de mensagem, por baixo do que já escreveu, para os enviar você.

O Voyager só lê respostas num chat em que a sua mensagem tem a ligação da página de criação do Voyager, e o pedido de **Criar nesta página** tem-na sempre. Em qualquer outro chat nada aparece por baixo das respostas; use as formas do popup abaixo. O separador **Criar** também tem **Copiar para um agente local**.

## Outras três formas

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

Um plugin declarativo não pode executar JavaScript, reagir a cliques ou teclas, carregar nada da rede (tipos de letra, imagens, folhas de estilo), ler ou reescrever o que uma mensagem diz, nem correr noutros sites. Quando só código resolve, a IA escreve uma criação que executa código, descrita abaixo. Nenhuma criação pode correr noutros sites nem mudar as definições do próprio Voyager; perante um pedido assim, o material de autoria diz à IA para o dizer claramente e para construir a versão mais próxima que funcione.

## Criações que executam código

Quando o CSS e as alterações de página não chegam, por exemplo para contar as suas mensagens ou reagir a um clique, a IA pode escrever uma criação que executa JavaScript. O Voyager executa-a como script de utilizador do Chrome, apenas nos sites que indica e só depois de ter lido o código.

### Ativá-la

A revisão marca uma criação assim com o distintivo **Executa código**.

- **Leia-a**: a revisão mostra os sites onde corre e o código-fonte completo. Ela pode ler tudo o que está nessas páginas, e o Voyager não consegue impedir que envie para outro lado o que lê, por isso instale apenas código em que confia.
- **Instalar e ativar**: ativa exatamente o código que leu. Uma versão posterior da IA fica desativada até a rever de novo, e o interruptor nunca é sincronizado com os seus outros dispositivos.
- **Interruptor único**: o Chrome só deixa uma extensão executar este código depois de o permitir. Escolha **Abrir a página de detalhes do Voyager**, ative lá **Permitir scripts de usuário** (Allow User Scripts; antes do Chrome 138, o **Modo do desenvolvedor** no topo de `chrome://extensions`), volte e escolha **Já ativei**.
- **Navegadores**: Chrome ou Edge para computador, versão 133 ou posterior. No Safari, no Firefox e em telemóveis fica instalada mas em pausa; peça à IA uma versão que só mude o aspeto da página.

### Manter o controlo

Em **Minhas criações**, cada uma mostra **Ativada, só neste dispositivo**, **Desativada** ou **Pausada** com o motivo.

- **Parar tudo**: **Parar todas as criações que executam código**, no fim de **Minhas criações** (o cartão do popup ou o separador **Recursos** do painel), para todas de uma vez; **Retomar** volta a iniciá-las.
- **Páginas abertas**: uma página já aberta continua a executá-las até ser recarregada. **Recarregar esta página** faz isso no separador atual.
- **Bloqueios**: se uma página deixar de responder depois de estas criações correrem nela, o Voyager desativa-as e indica-as num aviso na próxima vez que a página carregar. Depois de corrigida, reveja-a em **Minhas criações** e volte a ativá-la.

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
