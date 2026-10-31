# Pastas

Guarde as suas conversas em pastas na barra lateral: arraste uma para uma pasta e fica arquivada, encaixe pastas até três níveis e recupere as mesmas em outro dispositivo. As pastas funcionam no computador e em celulares Android.

<SiteSupport feature="folders" :labels="{ folders: 'Pastas na barra lateral', 'hide-filed': 'Ocultar conversas arquivadas', activity: 'Vista Activity', 'account-isolation': 'Isolamento de contas', projects: 'Pastas como projetos', 'ai-organize': 'Organizar com IA', 'move-menu': '**Mover para pasta** no menu da conversa', 'library-drag': 'Arrastar da tabela da Library', 'gem-icons': 'Ícones conforme o tipo de Gem' }" :only="[{ id: 'move-menu', sites: ['gemini', 'chatgpt', 'claude'] }, { id: 'library-drag', sites: ['aistudio'] }, { id: 'gem-icons', sites: ['gemini'] }]" />

<GuideHero src="/assets/gemini-folders.png" alt="A secção de pastas na barra lateral">

A secção de pastas fica por cima da lista de conversas, na barra lateral. Com a barra lateral fechada, as mesmas pastas continuam disponíveis num painel flutuante.

</GuideHero>

## Arquivar uma conversa

<GuideOp>

Qualquer conversa da barra lateral pode ir para uma pasta, e a mesma conversa pode estar em várias.

- **Arrastar**: arraste uma conversa da barra lateral para cima de uma pasta.
- **Menu da conversa**: nos sites que o permitem, abra o menu da conversa e escolha **Mover para pasta**.
- **Seleção múltipla**: prima longamente uma conversa dentro de uma pasta para selecionar várias e movê-las de uma vez.
- **AI Studio**: a barra lateral ainda não suporta seleção múltipla; pode arrastar conversas da tabela da Library para uma pasta.

</GuideOp>

## Encaixar e mudar o nome

<GuideOp side="end">

<GuideShot src="/assets/folders-nested-en.png" alt="Pastas encaixadas em três níveis" :width="240" />

As pastas vão até três níveis: uma pasta de topo pode ter mais dois níveis de subpastas.

- **Subpasta**: clique com o botão direito numa pasta e crie uma subpasta a partir do menu.
- **Mudar o nome**: faça duplo clique no nome da pasta, ou escolha **Renomear** no menu de contexto.
- **Recolher**: clique na seta antes de uma pasta para recolher ou expandir o que tem dentro.

</GuideOp>

### Menu e cores

<GuideOp side="end">

<GuideShot src="/assets/folders-menu-en.png" alt="O menu de contexto de uma pasta e as suas cores" :width="254" />

Clique com o botão direito numa pasta e tudo o que pode fazer com ela está no menu.

- **Afixar**: mantém a pasta no topo.
- **Cor**: escolha uma de 7 cores.
- **Eliminar**: apaga a pasta e tudo o que tem dentro, depois de confirmar.

</GuideOp>

<GuideNote>

**Visualização**: a roda dentada do cabeçalho das pastas muda a ordem das conversas (ordem manual ou abertas recentemente) e ajusta o tamanho do texto, o espaçamento das pastas e o recuo das subpastas; a opção **Espaçamento de pastas** da janela também o faz. No Safari para Mac, pode ser preciso atualizar a página para ver a alteração.

</GuideNote>

## Ocultar conversas arquivadas

<GuideOp>

Depois de pôr uma conversa numa pasta, pode tirá-la da lista principal para lá ficarem só as conversas em curso.

- **Gemini e AI Studio**: abra a janela → **Opções de Pasta** → **Ocultar conversas arquivadas**. Cada site guarda a sua própria definição; no AI Studio, ficam ocultas as linhas da tabela da Library.
- **Primeiro arquivo**: nestes dois sites, na primeira vez que arquiva uma conversa, um cartão na secção de pastas oferece ativá-lo com um clique. Escolha **Agora não** e não volta a perguntar.
- **Outros sites**: o interruptor está nas definições do plugin de pastas, na área **Plugins** da janela, e vem desativado.
- **Nada é eliminado**: as conversas arquivadas continuam nas suas pastas, e pode desativar isto quando quiser.

</GuideOp>

## Sincronizar e mudar

<GuideFacts>
<GuideFact title="Importar e exportar">

O ícone de pasta do cabeçalho tem **Importar pastas** e **Exportar pastas**. Exportar guarda um ficheiro JSON; importar junta-o às pastas que já tem, por isso o que já organizou fica como está.

<GuideShot src="/assets/folders-transfer-en.png" alt="Importar e exportar pastas" :width="160" />

</GuideFact>
<GuideFact title="Isolamento de contas">

O botão com forma de pessoa na barra lateral do Gemini mostra temporariamente só as conversas da conta Google atual; vem desativado. **Enable Hard Isolation**, em **Opções de Pasta** na janela, separa as pastas e os dados de sincronização por conta, e o botão esconde-se sozinho.

</GuideFact>
<GuideFact title="Sincronização na nuvem">

Todos os sites com pastas podem usar a sincronização na nuvem para ter as mesmas pastas noutro computador. As pastas de cada site são guardadas e sincronizadas em separado.

[Configurar a sincronização](/pt/guide/cloud-sync)

</GuideFact>
<GuideFact title="Vista Activity">

O sino do cabeçalho troca a árvore por uma vista Activity só de leitura, com as conversas dos últimos dias ordenadas pela última atividade real; prima-o outra vez para voltar à árvore. Nunca move, copia nem reclassifica conversas.

[Leia o guia completo da vista Activity](/pt/guide/activity-view)

</GuideFact>
</GuideFacts>

## Organizar com IA

Demasiadas conversas para organizar à mão? Deixe o Gemini propor um plano de pastas.

<GuideSteps>
<GuideStep>

Abra a janela no Gemini e clique em **Organizar com IA** no fundo de **Opções de Pasta**. As conversas por arquivar e a estrutura atual de pastas são copiadas como um prompt; o prompt e os nomes das pastas usam o seu idioma.

<GuideShot kind="panel" src="/assets/ai-auto-folder.png" alt="O botão Organizar com IA na janela" :width="326" />

</GuideStep>
<GuideStep>

Cole o prompt no Gemini. Ele responde com um plano de pastas em JSON.

</GuideStep>
<GuideStep>

Clique em **Importar pastas** no cabeçalho, escolha **Ou colar JSON diretamente**, cole e clique em **Importar**. **Mesclar com pastas existentes** é a opção predefinida: só acrescenta pastas novas e novas atribuições, sem mexer nas que já tem.

</GuideStep>
</GuideSteps>

## Pastas como projetos

Dê a uma pasta instruções para o primeiro turno e uma conversa nova arquiva-se sozinha nela depois da primeira mensagem. A ideia vem dos Claude Projects, mas o Voyager só acrescenta instruções do primeiro turno e arquivo automático; não é um espaço de trabalho com contexto partilhado.

<GuideSteps>
<GuideStep>

Ative **Habilitar Pasta como Projeto** na janela.

</GuideStep>
<GuideStep>

Clique com o botão direito numa pasta e escolha **Definir instruções** ou **Editar instruções**.

</GuideStep>
<GuideStep>

Abra uma conversa nova do Gemini e escolha a pasta no seletor ao lado da caixa de texto.

</GuideStep>
<GuideStep>

Envie a primeira mensagem.

</GuideStep>
</GuideSteps>

<GuideNote>

**A seguir**

- Depois do primeiro envio, a conversa é arquivada nessa pasta.
- Se a pasta tiver instruções, o Voyager só as junta a esse primeiro envio. Sem instruções, a pasta serve de atalho para arquivar conversas novas.
- As conversas da mesma pasta **não** partilham memória nem leem o conteúdo umas das outras.
- O guardar automático do rascunho só mantém o que escreveu, nunca as instruções ocultas.

</GuideNote>

Para a largura da barra lateral, veja [Largura da barra lateral](/pt/guide/sidebar).
