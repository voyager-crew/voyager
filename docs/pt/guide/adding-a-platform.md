# Adicionando uma nova plataforma

Adicionar um novo site de chat tem duas camadas separadas:

1. O **adaptador do site**, `catalog/sites/<site>/site.json`, ensina o Voyager a
   reconhecer o site e a encontrar as mensagens do usuário, as respostas do
   assistente, a entrada de prompt, a barra lateral e os marcadores de tema.
2. Um **plugin** em `catalog/sites/<site>/plugins/<id>/` resolve um problema
   específico do usuário nesse site, como a largura de leitura ou a correção de
   uma renderização.

Um `site.json` contém `id` (igual ao nome do diretório), `label`, `matches`,
`selectors`, `theme`, `brandColor`, `capabilities` e, opcionalmente,
`conversationIdPattern` e `turnKeyAttributes`. O `turnKeyAttributes` indica os
atributos que mantêm a identidade de uma mensagem do usuário quando a página a
renderiza de novo; o rastreamento de envio (usado pela Atividade das pastas e
pelos carimbos de data/hora da linha do tempo) só roda em um site que o defina,
junto com `composer`, `userTurn` e um `conversationIdPattern`.
`validateSiteAdapterData`, em `src/features/plugins/sites/siteAdapterData.ts`,
faz essa validação, e `bun run catalog:build` valida todos os sites e plugins
antes da publicação.

`site.json` é o próprio adaptador de site escrito como dados. Hoje as plataformas são ChatGPT, Claude, DeepSeek, Kimi e Grok. O Gemini e o AI Studio são superfícies nativas do Voyager com o seu próprio `site.json` (`catalog/sites/gemini/` e `catalog/sites/aistudio/`), mas este vai dentro do pacote e nunca é publicado no catálogo remoto; `sites/adapters/gemini.ts`, `aistudio.ts`, `claude.ts`, `chatgpt.ts` e `deepseek.ts` são invólucros de uma linha sobre o respetivo `site.json`: edite o JSON, não o TypeScript. O catálogo publicado por host transporta também os dados do site, por isso uma correção de seletores chega aos utilizadores sem uma nova versão da extensão. Um site completamente novo ainda precisa de uma nova versão, porque também depende de permissão de host e do registro do content script, que vêm dentro do pacote.

Para uma nova plataforma, como o DeepSeek, mantenha o trabalho do adaptador
focado no contrato da plataforma. Coloque o `site.json`, os testes obrigatórios
de seletores e a documentação mínima necessária para explicar o suporte em uma
única mudança completa. O registro de sites pega o novo adaptador a partir do
próprio arquivo, então não há lista de registro para editar. Não adicione um
novo site para cada plugin.

Depois que o adaptador for aceito, os plugins seguintes podem ser enviados como
mudanças separadas e focadas. Se várias mudanças dependem umas das outras, uma
cadeia de PRs empilhados é útil: cada branch posterior é baseada na anterior, e
cada PR mostra apenas a sua própria funcionalidade incremental. A cadeia ainda
deve seguir a mesma regra de escopo: um objetivo claro para o usuário por PR, com
seus testes obrigatórios e a limpeza necessária.

Suporte a um site não exige integração com API de modelo. Não adicione content
scripts estáticos nem permissões de host obrigatórias para uma nova plataforma;
use o fluxo existente de permissão opcional e registro dinâmico para sites que
têm apenas plugins.

O caminho de permissão opcional e de registro dinâmico depende da versão do
navegador. Chrome e Edge suportam o fluxo usado pela extensão. O Firefox exige a
versão 128 ou mais recente para permissões de host opcionais, e o Safari exige a
versão 16.4 ou mais recente para o registro dinâmico de content scripts. Em
versões mais antigas dos navegadores compatíveis, o popup pode recusar corretamente
ativar um plugin para um site personalizado, porque as APIs necessárias não
conseguem manter uma permissão persistente; não contorne isso adicionando uma
permissão de host estática ampla sem aprovação do mantenedor.
