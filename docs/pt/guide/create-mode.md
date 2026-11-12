# Modo criação

Diga em uma frase como você quer que um site mude, como "deixe minhas mensagens mais estreitas". A IA desse site faz a mudança para você, e o Voyager confere antes de instalar. Você não precisa saber nada de código e nem sai da página. Funciona no Gemini, AI Studio, ChatGPT, Claude, DeepSeek e Kimi.

O que você faz se chama criação. É um pequeno plugin que fica só neste navegador. Você pode desligar ou apagar quando quiser.

<GuideHero src="/assets/create-mode-hero-en-light.png" dark="/assets/create-mode-hero-en-dark.png" alt="O painel do Voyager aberto em um site de IA, na aba Criar, com um pedido de uma frase escrito">

O modo criação tem duas entradas. A primeira é a aba **Criar** do [painel do Voyager](./panel.md), na página. A segunda é o cartão **Minhas criações** no popup do Voyager. O popup é a janelinha que abre quando você clica no ícone do Voyager na barra de ferramentas do navegador.

</GuideHero>

## Criar na página

<GuideOp>

O jeito mais rápido é fazer no próprio site de IA que você quer mudar. Abra o painel do Voyager lá e escolha **Criar**.

<GuideShot kind="panel" src="/assets/create-mode-ask-en.png" alt="A aba Criar: a caixa para uma frase, o interruptor da estrutura da página e os botões para copiar para um agente local e criar nesta página" :width="632" />

</GuideOp>

<GuideSteps>
<GuideStep>

Escreva uma frase em **O que deve mudar?**, como "Deixe minhas mensagens mais estreitas e esconda a barra lateral". Depois escolha **Criar nesta página**.

</GuideStep>
<GuideStep>

O Voyager abre uma conversa nova nesse site e coloca seu pedido na caixa de mensagem. Leia e depois aperte enviar você mesmo. O Voyager nunca envia nada por você. Se a caixa de mensagem já tiver texto, o Voyager não mexe nele. Ele pede que você envie ou apague esse texto primeiro.

</GuideStep>
<GuideStep>

Quando a IA responder, um botão do Voyager aparece embaixo da resposta: **Revisar e instalar**.

<GuideShot src="/assets/create-mode-reply-en.png" alt="O botão Revisar e instalar do Voyager, sob uma resposta da IA" :width="267" />

</GuideStep>
<GuideStep>

Escolha esse botão. O painel mostra o que a criação vai mudar, em quais sites ela funciona e o que estiver em **Confira antes**. Se estiver tudo certo, escolha **Instalar e ativar**. A mudança aparece na hora. Se não quiser mais, desative a criação na aba **Recursos** do painel.

<GuideShot kind="panel" src="/assets/create-mode-review-en.png" alt="A revisão no painel: nome da criação, seus sites, o que muda, o que verificar primeiro e o botão para instalar e ativar" :width="632" />

</GuideStep>
</GuideSteps>

<GuideOp>

Para mudar de novo, continue conversando com a IA na mesma conversa.

- **Uma nova versão**: **Revisar atualização** aparece embaixo da nova resposta da IA. Dê uma olhada e escolha **Atualizar e ativar**. As respostas mais antigas mostram **Versão anterior**.
- **Já instalada**: a resposta que você instalou mostra **Instalado**.
- **Só nessas conversas**: os botões só aparecem numa conversa que você começou com **Criar nesta página**. Para qualquer outra conversa, use "Criar pelo popup", mais abaixo.

</GuideOp>

## Deixar a IA ver a página

<GuideOp>

A aba **Criar** tem um único interruptor: **Adicionar como esta página é feita, sem nada do texto dela, para a IA escrever para o que existe aqui**. Ele já vem ligado.

- **O que é adicionado**: o desenho da página. Ou seja, quais botões, caixas de texto e áreas de mensagem ela tem, e onde ficam. Com isso, a IA não precisa adivinhar.
- **O que nunca é adicionado**: nenhum texto da página, nem suas conversas. Também não vão endereços de sites nem dados da sua conta.
- **Veja você mesmo**: escolha **Ver o que é adicionado**. Ali está tudo o que vai para a IA.
- **Deixar de fora**: desligue o interruptor. Aí o pedido leva só a sua frase.

<GuideShot kind="panel" src="/assets/create-mode-structure-en.png" alt="O que é anexado, aberto: a estrutura da página como nomes e quantidades de suas partes, sem texto" :width="612" />

</GuideOp>

## O aviso de modelo no Gemini

<GuideOp>

O Gemini tem vários modelos para escolher. Flash e Flash-Lite são os mais leves. Eles geralmente não conseguem fazer uma criação que funcione. Se a conversa nova for usar um deles, o topo da aba **Criar** avisa você.

- **O que fazer**: o aviso indica um modelo melhor. Troque para ele no menu de modelos do Gemini e escolha **Verificar de novo**.
- **Outro caminho**: escolha **Copiar para um agente local** no aviso. Assim, o trabalho vai para um assistente de programação no seu computador. Veja [Escreva o seu próprio plugin](./write-a-plugin.md).
- **Não impede nada**: é só um aviso. **Criar nesta página** continua funcionando.

<GuideShot kind="panel" src="/assets/create-mode-model-en.png" alt="O aviso no topo da aba Criar de que o Flash do Gemini costuma não escrever um plugin, com os botões para verificar de novo e copiar para um agente local" :width="616" />

</GuideOp>

## Quando não dá para instalar

<GuideOp>

A IA nem sempre acerta de primeira. Quando isso acontece, uma linha embaixo da resposta explica o motivo, como "Não diz em qual site funciona".

- **Pedir para corrigir**: escolha **Pedir para corrigir** embaixo da resposta. O Voyager escreve os problemas na caixa de mensagem, e você aperta enviar.
- **Depois de corrigido**: quando a IA mandar a versão corrigida, **Revisar e instalar** aparece embaixo dela de novo.
- **Nada muda enquanto isso**: uma criação que não foi instalada não mexe na sua página.

<GuideShot src="/assets/create-mode-rejected-en.png" alt="A linha sob uma resposta da IA dizendo que o plugin não pode ser instalado porque não indica o site, com o botão Pedir para corrigir" :width="624" />

</GuideOp>

## Depois de instalar

<GuideOp>

Tudo o que você instalou fica em **Minhas criações**.

- **No painel**: o grupo **Minhas criações** na aba **Recursos**. Cada criação tem sua linha, com seu próprio interruptor.
- **No popup**: no Gemini e no AI Studio, é um cartão. Ele fica embaixo de **Sincronização na Nuvem**, a não ser que você mude de lugar. **Ir para**, no topo do popup, leva você até lá. Nos outros sites, fica embaixo da lista de plugins.
- **Apagar**: escolha o ícone de lixeira na linha dela e confirme. Não dá para desfazer.
- **Levar para outro navegador**: em **Minhas criações** no popup, escolha **Exportar** na criação. Você recebe um arquivo. Importe esse arquivo no outro navegador.
- **Compartilhar com todo mundo**: se ela puder ajudar outras pessoas, você pode sugerir que entre no Voyager. [Contribuir plugins](./plugin-contribution.md) explica como.

</GuideOp>

### A verificação automática

<GuideOp>

Toda vez que você abre o painel, o Voyager confere se suas criações fazem algo na página atual.

- **Não funciona aqui**: uma criação está ligada, mas não acha nada para mudar nesta página. A linha dela mostra **Ligado, mas nada nesta página corresponde a ele**. Isso costuma acontecer quando o site muda de visual.
- **A página travou**: uma criação que executa código travou a página. O Voyager já desligou essa criação, e a linha dela diz por quê.
- **Pedir para corrigir**: nos dois casos aparece **Pedir para corrigir**. Escolha essa opção. O Voyager abre uma conversa nova com o problema já escrito. O painel fecha para você ler e apertar enviar.

<GuideShot kind="panel" src="/assets/create-mode-creations-en.png" alt="Minhas criações na aba Recursos: uma criação está ativa mas nada nesta página corresponde, com o botão Pedir para corrigir" :width="414" />

</GuideOp>

## Mudar as cores do Voyager

<GuideOp>

Uma criação também pode mudar as cores do próprio Voyager. É só pedir, como "deixe o Voyager com as cores Nord".

- **O que muda**: os painéis, menus, janelas, avisos e a linha do tempo do Voyager. No modo claro e no escuro.
- **O que não muda**: as cores do próprio site, e o texto que o Voyager escreve direto na página do site. Assim esse texto nunca se mistura com o fundo do site. O popup do Voyager também não muda.
- **Para voltar**: desligue a criação. As cores voltam ao normal.

</GuideOp>

## Criar pelo popup

<GuideOp>

Quer pular a conversa nova, ou deixar outra conversa ou outra IA fazer o trabalho? Comece por **Minhas criações** no popup. **Crie o seu**, no fim da lista de plugins, leva você até lá.

</GuideOp>

<GuideSteps>
<GuideStep>

Escreva uma frase em **O que deve mudar?**. Logo abaixo, **Site** começa com o site em que você está. Mude se a criação for para outro site.

</GuideStep>
<GuideStep>

Escolha **Copiar para este chat**. Depois cole o texto copiado na conversa com a IA desse site e envie.

</GuideStep>
<GuideStep>

Quando a IA responder, copie a resposta inteira. Cole em **Cole a resposta da IA** e escolha **Verificar resposta**.

</GuideStep>
<GuideStep>

O Voyager explica em palavras simples o que vai mudar. Escolha **Importar** e depois ligue a criação na lista de plugins. Uma criação adicionada assim começa desligada.

</GuideStep>
</GuideSteps>

<GuideOp>

Neste caminho, o Voyager não envia nada sozinho. Você cola o texto lá e traz a resposta de volta.

</GuideOp>

## Criações que executam código

<GuideOp>

A maioria das criações só muda a aparência. Alguns pedidos precisam de mais, como contar suas mensagens ou fazer algo quando você clica. Para esses, a IA faz uma criação que executa código. A revisão marca essa criação com **Executa código**.

</GuideOp>

### Ativá-la

<GuideOp>

- **Olhe antes**: a revisão mostra em quais sites ela roda e todo o código dela. Ela consegue ver tudo nessas páginas, inclusive suas conversas. O Voyager não consegue impedir que ela mande o que vê para outro lugar. Por isso, ative só as criações em que você confia.
- **Instalar e ativar**: ativa exatamente a versão que você acabou de olhar. Uma versão mais nova da IA fica desligada até você olhar de novo. O interruptor vale só para este dispositivo.
- **Uma configuração que se faz uma vez só**: o navegador precisa deixar o Voyager rodar essas criações. Escolha **Abrir a página de detalhes do Voyager** e ative **Permitir scripts de usuário** (Allow User Scripts). Depois volte e escolha **Já ativei**.
- **Navegadores**: Chrome ou Edge no computador, versão 133 ou mais nova. No Safari, no Firefox e no celular, ela continua instalada, mas pausada. Você pode pedir à IA uma versão que só muda a aparência da página.

<GuideShot kind="panel" src="/assets/create-mode-scripted-en.png" alt="A revisão de uma criação que executa código: a marca Executa código, o aviso, o código completo e os passos de Allow User Scripts" :width="632" />

</GuideOp>

### Manter o controle

<GuideOp>

Em **Minhas criações**, cada criação que executa código mostra **Ativada, só neste dispositivo**, **Desativada** ou **Pausada**. Quando está pausada, o motivo aparece junto.

- **Parar todas**: escolha **Parar todas as criações que executam código**, no fim de **Minhas criações**. Escolha **Retomar** para ligar de novo.
- **Páginas já abertas**: elas continuam rodando até você recarregar a página. **Recarregar esta página** recarrega a página atual.
- **Uma página travada**: se uma página travar por causa delas, o Voyager desliga essas criações. Na próxima vez que a página abrir, um aviso diz quais foram.

</GuideOp>

## O que ele pode e não pode fazer

<GuideOp>

- **Pode**: mudar a aparência de uma página, como largura, tamanho do texto e cores. Esconder partes que você não quer ver. Adicionar interruptores e controles deslizantes às configurações. Mudar as cores do Voyager. Em alguns sites, também pode ligar recursos do próprio Voyager, como copiar fórmulas e a linha do tempo.
- **Precisa de código**: fazer algo ao clicar, contar coisas, ler o que está na página. Veja "Criações que executam código" acima.
- **Nenhuma pode**: rodar em outros sites ou mudar as configurações do próprio Voyager. Diante de um pedido assim, a IA avisa e faz a versão mais parecida possível.

</GuideOp>

## Os detalhes

<GuideOp>

Esta seção é para quem quer saber como tudo funciona por baixo. Pode pular se você só quer usar.

- **O que é uma criação**: um plugin local, feito de um manifest de plugin e de estilos. Para escrever um à mão, ver as regras e as variáveis de cor usadas para mudar as cores do Voyager, veja [Escreva o seu próprio plugin](./write-a-plugin.md).
- **O que a IA lê**: o pedido traz um link para as instruções do Voyager para o site, como `https://voyager.nagi.fun/create/claude.md`. A IA responde com um único bloco de código JSON. O Voyager só mostra os botões numa conversa em que a mensagem traz esse link. Por isso, no caminho pelo popup, a IA precisa conseguir abrir links.
- **A estrutura da página**: quais elementos da página o Voyager reconhece e quantos são, e a árvore de elementos ao redor da última resposta e da sua última mensagem. Sem texto e sem endereços web. Valores de atributo que parecem IDs, e-mails ou números longos também saem.
- **O aviso de modelo**: o Voyager lê o modelo que a conversa nova vai receber. Com [Modelo Padrão](./default-model.md) ligado, ele julga por esse modelo padrão. Ele confere de novo quando você volta ao painel.
- **A verificação automática**: o Voyager só olha se os estilos e as mudanças de página da criação encontram algo na página atual. Estados de hover e foco não contam, nem criações que só chamam recursos integrados.
- **A execução de código**: roda pelos scripts de usuário do Chrome, e só nos sites que a criação lista. Antes do Chrome 138, o interruptor é o **Modo do desenvolvedor**, no topo de `chrome://extensions`.

</GuideOp>
