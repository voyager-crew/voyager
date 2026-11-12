# Modo criação

Diga em uma frase como um site deve mudar. A própria IA do site escreve isso como plugin, e o Voyager confere e instala para você. Sem código, e sem sair da conversa em que você está. Funciona no Gemini, AI Studio, ChatGPT, Claude, DeepSeek e Kimi.

O modo criação tem duas entradas: a aba **Criar** do [painel do Voyager](./panel.md) na página, e o cartão **Minhas criações** no popup do Voyager. O que ele cria é um plugin local, que fica só no seu navegador. Para escrever um plugin você mesmo ou entregá-lo a um agente de programação, veja [Escreva o seu próprio plugin](./write-a-plugin.md).

## Criar na página

<GuideOp>

O jeito mais rápido funciona no site de IA para o qual o plugin é feito: abra o painel do Voyager lá e escolha **Criar**.

</GuideOp>

<GuideSteps>
<GuideStep>

Escreva uma frase em **O que deve mudar?**, como "Deixe minhas mensagens mais estreitas e esconda a barra lateral", e escolha **Criar nesta página**.

</GuideStep>
<GuideStep>

O Voyager abre um chat novo nesse site e coloca seu pedido na caixa de mensagem. Leia e depois envie você mesmo: o Voyager nunca aperta enviar. Se a caixa de mensagem já tiver texto, o Voyager não mexe nele e pede que você envie ou apague esse texto primeiro.

</GuideStep>
<GuideStep>

A IA lê a página do Voyager para o site e responde com um único bloco de código JSON. Embaixo do bloco, o Voyager adiciona **Revisar e instalar**.

</GuideStep>
<GuideStep>

Escolha essa opção. O painel abre numa revisão: os sites onde o plugin funciona, cada mudança, o CSS completo e o que estiver em **Confira antes**. Escolha **Instalar e ativar**, e ele passa a valer na hora. Você pode desativá-lo quando quiser em **Recursos**.

</GuideStep>
</GuideSteps>

<GuideOp>

Para mudar o plugin, peça à IA no mesmo chat.

- **Uma nova versão**: embaixo da nova resposta, o Voyager oferece **Revisar atualização** e depois **Atualizar e ativar**; o bloco mais antigo mostra **Versão anterior**.
- **Já instalado**: a versão que você instalou mostra **Instalado**.
- **Só em chats de criação**: o Voyager só lê respostas num chat em que sua mensagem tem o link da página de criação do Voyager, e o pedido de **Criar nesta página** sempre tem. Em qualquer outro chat nada aparece embaixo das respostas; use o caminho pelo popup, descrito abaixo.

</GuideOp>

## Adicionar a estrutura da página

<GuideOp>

A aba **Criar** tem um único interruptor: **Adicionar como esta página é feita, sem nada do texto dela, para a IA escrever para o que existe aqui**. Ele vem ativado. Assim a IA escreve para a página como ela realmente é, em vez de adivinhar.

- **O que é adicionado**: quais elementos da página o Voyager reconhece e quantos são, e a árvore de elementos ao redor da última resposta e da sua última mensagem.
- **O que fica de fora**: qualquer texto da página, links, suas conversas e valores de atributo que parecem dados, como IDs, e-mails ou números longos.
- **Ver o que é adicionado**: abra para ler exatamente o texto que será anexado. Ele lê a página de novo quando ela muda.
- **Desativado**: desative o interruptor, e o pedido leva só a sua frase.

</GuideOp>

## O aviso de modelo no Gemini

<GuideOp>

No Gemini, o Voyager primeiro confere qual modelo o chat novo vai usar. Se for um modelo mais leve, como Flash ou Flash-Lite, o topo da aba **Criar** avisa que esse modelo geralmente não consegue escrever um plugin.

- **O que ele sugere**: o aviso indica um modelo mais forte para escolher no menu de modelos do Gemini, ou oferece entregar o pedido a um agente de programação local (**Copiar para um agente local** fica no próprio aviso).
- **Verificar de novo**: depois de trocar de modelo no Gemini, escolha **Verificar de novo**. O Voyager também confere de novo quando você volta ao painel.
- **Modelo padrão**: se você usa [Modelo Padrão](./default-model.md), o Voyager julga pelo modelo padrão que o chat novo vai receber.
- **Não bloqueia nada**: é só um aviso. **Criar nesta página** continua funcionando.

</GuideOp>

## Quando uma resposta não pode ser instalada

<GuideOp>

Nem toda resposta sai certa. Embaixo de uma resposta que não consegue instalar, o Voyager explica o motivo em palavras simples, como "Não diz em qual site funciona" ou "Uma das mudanças dele não é permitida".

- **Pedir para corrigir**: escolha **Pedir para corrigir** embaixo da resposta. O Voyager coloca a lista de problemas na caixa de mensagem, depois do que você já tiver digitado, para você enviar.
- **Depois de corrigido**: quando a IA responde com uma versão corrigida, **Revisar e instalar** aparece embaixo dela.
- **Durante a revisão**: se os problemas só aparecem na revisão do painel, o Voyager não instala nada e mostra a lista.

</GuideOp>

## Depois de instalar

<GuideOp>

Tudo o que você instalou fica em **Minhas criações**. No painel, é um grupo da aba **Recursos**. No popup, no Gemini e no AI Studio é um cartão das configurações, logo abaixo de **Sincronização na Nuvem** se você não mudar de lugar, e **Ir para**, no topo do popup, leva até ele; no ChatGPT, Claude, DeepSeek e Kimi fica embaixo da lista de plugins.

- **Interruptor**: cada criação tem uma linha e liga e desliga como qualquer outro recurso.
- **Remover**: escolha o ícone de lixeira e confirme para removê-la deste navegador. Não dá para desfazer.
- **Exportar**: escolha **Exportar** nela, na lista de **Minhas criações** do popup, e depois importe o arquivo JSON em outro navegador.
- **Compartilhar**: se ela puder ajudar todo mundo, proponha-a para o catálogo oficial: [Contribuir plugins](./plugin-contribution.md) descreve esse caminho.

</GuideOp>

### A verificação automática

<GuideOp>

Quando o painel abre, o Voyager confere se cada criação em **Minhas criações** faz algo na página atual.

- **Nada corresponde**: uma criação que muda o visual está ativada, mas nenhum elemento que ela altera está nesta página. A linha dela mostra **Ligado, mas nada nesta página corresponde a ele**. Estados de hover e foco não contam, nem criações que só chamam recursos integrados.
- **Uma página travada**: quando uma criação que executa código fez a página parar de responder, o Voyager já a desativou, e a linha dela diz por quê.
- **Pedir para corrigir**: os dois casos oferecem **Pedir para corrigir**. O Voyager abre um chat novo neste site e preenche com o que viu na página e o plugin como está instalado (mais a estrutura da página, enquanto aquele interruptor estiver ativado). O painel fecha para você ler e enviar.

</GuideOp>

## Mudar as cores do Voyager

<GuideOp>

Uma criação também pode mudar as cores da própria interface do Voyager na página, de novo a partir de uma frase, como "Dê uma paleta Nord aos painéis e à linha do tempo do Voyager". A IA define as variáveis de cor públicas do Voyager numa única regra `:root`, e elas valem tanto no tema claro quanto no escuro.

- **O que segue a paleta**: o fundo, o texto, as bordas e a cor de hover de painéis, menus, diálogos, dicas e notificações; o destaque de botões, seleção e foco; a cor de perigo para excluir.
- **A linha do tempo**: o trilho, os pontos e marcas em repouso e a trilha do controle deslizante da esquerda têm uma cor própria.
- **O que continua seguindo o site**: o texto, as bordas e a cor de hover que o Voyager desenha direto na página do site. Assim, texto claro nunca cai sobre o fundo claro do site. O popup do Voyager não é afetado.

</GuideOp>

<GuideNote>

**Um exemplo Nord**: a frase acima costuma gerar um CSS como este. Uma variável não definida mantém a cor original do Voyager.

```css
:root {
  --gv-theme-surface: #2e3440;
  --gv-theme-hover: #3b4252;
  --gv-theme-text: #eceff4;
  --gv-theme-text-muted: #d8dee9;
  --gv-theme-border: #4c566a;
  --gv-theme-accent: #88c0d0;
  --gv-theme-accent-fg: #2e3440;
  --gv-theme-danger: #bf616a;
  --gv-theme-timeline: #81a1c1;
}
```

Todas as variáveis: `--gv-theme-surface` (fundo), `-hover` (linhas sob o cursor), `-text` (texto), `-text-muted` (texto secundário, ícones), `-border` (bordas), `-accent` (botões, seleção, foco), `-accent-fg` (texto sobre o destaque), `-accent-hue` (o matiz OKLCH do destaque, um número), `-danger` (excluir), `-timeline` (trilho e pontos sobre o fundo do site).

</GuideNote>

## Sem o painel: criar pelo popup

<GuideOp>

Para pular o chat novo, ou para que outro chat ou outra IA escreva o plugin, comece por **Minhas criações** no popup. **Crie o seu**, no fim da lista de plugins, leva você ao primeiro campo do cartão.

</GuideOp>

<GuideSteps>
<GuideStep>

Escreva uma frase em **O que deve mudar?**. O campo **Site** logo abaixo começa com o site da aba atual; mude se o plugin for para outro site.

</GuideStep>
<GuideStep>

Escolha **Copiar para este chat** e cole a mensagem no chat de IA desse site. A IA lê a página do Voyager para o site, como `https://voyager.nagi.fun/create/claude.md`, e responde com um único bloco de código JSON. A IA precisa conseguir abrir links.

</GuideStep>
<GuideStep>

Cole a resposta inteira em **Cole a resposta da IA** e escolha **Verificar resposta**.

</GuideStep>
<GuideStep>

O Voyager mostra em linguagem simples o que o plugin muda. Escolha **Importar** e ative o plugin na lista de plugins; no Gemini e no AI Studio, o interruptor dele aparece logo abaixo do cartão. Um plugin importado assim começa desativado.

</GuideStep>
</GuideSteps>

<GuideOp>

Neste caminho, o Voyager não envia nada por conta própria. Você cola a mensagem e traz a resposta de volta.

</GuideOp>

## Criações que executam código

<GuideOp>

Quando CSS e mudanças na página não dão conta do pedido, como contar suas mensagens ou reagir a um clique, a IA pode escrever uma criação que executa JavaScript. O Voyager a executa pelos scripts de usuário do Chrome, só nos sites que ela lista e só depois que você leu o código. A revisão marca uma criação assim com o selo **Executa código**.

</GuideOp>

### Ativá-la

<GuideOp>

- **Leia o código**: a revisão lista os sites onde ela roda e mostra o código-fonte completo. Ela pode ler tudo nessas páginas, inclusive suas conversas, e o Voyager não consegue impedir que ela envie para outro lugar o que lê. Por isso, instale só código em que você confia.
- **Instalar e ativar**: ativa exatamente o código que você leu. Se o código ou os sites dela mudarem depois, ela fica pausada até você revisar de novo, e o interruptor nunca é sincronizado com seus outros dispositivos.
- **Permissão única**: o Chrome só deixa uma extensão executar esse tipo de código depois que você permite. Escolha **Abrir a página de detalhes do Voyager**, ative **Permitir scripts de usuário** lá (Allow User Scripts; antes do Chrome 138, o **Modo do desenvolvedor** no topo de `chrome://extensions`), volte e escolha **Já ativei**.
- **Navegadores**: Chrome ou Edge para desktop, versão 133 ou mais recente. No Safari, no Firefox e no celular ela continua instalada, mas pausada; peça à IA uma versão que só mude o visual da página.

</GuideOp>

### Manter o controle

<GuideOp>

Em **Minhas criações**, cada criação que executa código mostra **Ativada, só neste dispositivo**, **Desativada** ou **Pausada** com o motivo.

- **Parar tudo**: **Parar todas as criações que executam código**, no fim de **Minhas criações** (o cartão do popup ou a aba **Recursos** do painel), para todas de uma vez; **Retomar** inicia todas de novo.
- **Páginas abertas**: uma página que já está aberta continua executando essas criações até ser recarregada. **Recarregar esta página** faz isso na aba atual.
- **Travamentos**: se uma página parar de responder depois que essas criações rodaram nela, o Voyager as desativa e cita os nomes num aviso na próxima vez que a página carregar. Depois que a criação for corrigida, revise-a em **Minhas criações** e ative-a de novo.

</GuideOp>

## O que ele pode e não pode fazer

<GuideOp>

A maioria das criações muda só o visual e o layout da página, não executa código próprio e desfaz todas as mudanças quando você a desativa.

- **Pode**: mudar o estilo da página, esconder partes dela, adicionar interruptores e controles deslizantes às configurações, mudar as cores do Voyager e, nos sites de plugins, ativar recursos integrados do Voyager (copiar fórmulas, a linha do tempo, diagramas Mermaid e outros).
- **Precisa de código**: reagir a cliques, contar coisas ou ler a página exige uma criação que executa código, descrita acima.
- **Nenhuma criação pode**: rodar em outros sites ou mudar as configurações do próprio Voyager. Diante de um pedido assim, a IA avisa e cria a versão mais próxima que funciona.
- **As regras completas**: quais campos um plugin pode usar e o que a importação confere estão em [Escreva o seu próprio plugin](./write-a-plugin.md#o-que-um-plugin-pode-fazer).

</GuideOp>
