# Guia de contribuição de plugins

O sistema de plugins do Voyager dá prioridade a plugins declarativos: `plugin.json` descreve os metadados e operações DOM, enquanto o CSS descreve os estilos. O plugin não executa JavaScript remoto; o motor de plugins integrado do Voyager interpreta o manifest e os estilos.

Isto torna os plugins mais fáceis de rever e manter. Se quiser contribuir com um plugin, comece por este caminho.

## Só para você: plugins locais

Um plugin de que você só precisa no seu próprio navegador não passa por este processo. Crie-o como plugin local e importe-o no popup: sem Issue, sem PR, sem clonar o repositório. O jeito mais rápido é o [modo criação](./create-mode.md): uma frase, e a IA do site escreve o plugin. Para entregá-lo a um agente de código ou escrevê-lo à mão, veja [Escreva seu próprio plugin](./write-a-plugin.md), incluindo o verificador `create-voyager-plugin` e a skill para agentes de código.

## Caminho recomendado

1. Confirme primeiro que a ideia é adequada para plugin: largura de leitura, correções de layout, ajustes de tema, ocultar ou marcar elementos da página e adaptações simples de sites são bons candidatos.
2. Abra primeiro uma Issue no repositório principal do Voyager. Explique o problema, o site alvo e a diferença face aos plugins existentes; aguarde a aprovação explícita de um mantenedor antes de programar ou abrir uma PR.
3. Use `plugin.json` para metadados, sites correspondentes, definições e contribuições.
4. Coloque os estilos em `style.css` no mesmo diretório e referencie-o em `contributes.styles`.
5. Teste localmente e inclua páginas de teste, capturas de ecrã ou uma gravação curta na PR. Os mantenedores decidirão se está pronto para o catalog oficial.

## Estrutura de diretórios

Os plugins oficiais incluídos ficam em `src/features/plugins/catalog/`, com um diretório por plataforma:

```
src/features/plugins/catalog/
  marketplace.json                        índice dos plugins de site, mantido à mão e verificado por um teste
  sites/<site>/site.json                  o adaptador de site, como dados
  sites/<site>/plugins/<id>/plugin.json   um plugin declarativo
  sites/<site>/plugins/<id>/style.css     os seus estilos
  sites/<site>/plugins/<id>/README.md     o que corrige e porquê
```

A descoberta é automática: `catalog/sites/index.ts` encontra cada `site.json` e cada `plugin.json` com `import.meta.glob`, por isso acrescentar um site ou um plugin é acrescentar ficheiros. Não há tabela de mapeamento para editar.

`marketplace.json` não é essa tabela: é apenas um índice dos plugins de site, mantido à mão. Um teste mantém-no sincronizado com a descoberta, portanto um plugin novo também precisa de uma entrada aí (o `bun run plugin:new` acrescenta-a por si). O `source` é o caminho relativo ao catalog, por exemplo `sites/deepseek/plugins/reading-width/plugin.json`. Os plugins em `sites/gemini/` e `sites/aistudio/` são a exceção: vão dentro do Voyager e ficam fora do `marketplace.json`. A página [Todos os plugins](/pt/guide/plugins) da documentação lê os manifests diretamente do disco, não este ficheiro.

Os `matches` de um plugin têm de ficar dentro dos `matches` do seu site. Um plugin que saia desse âmbito faz a build falhar.

## Chaves de seletor semântico

`site.json` associa um vocabulário fixo de chaves semânticas a seletores CSS próprios do site. O vocabulário está definido em `src/features/plugins/sites/semanticKeys.ts`; um `site.json` só pode usar estas chaves e qualquer chave desconhecida é rejeitada.

- `userTurn`: o contentor de uma mensagem do utilizador.
- `assistantTurn`: o contentor de uma mensagem do assistente.
- `thinkingBlock`: a secção de raciocínio dentro de uma resposta.
- `codeBlock`: um bloco de código renderizado.
- `composer`: o campo onde se escreve o prompt.
- `sidebar`: a lista de conversas ou a barra de navegação.
- `sidePanel`: um painel secundário, como artifacts ou canvas.
- `headerActions`: o grupo de ações no canto superior direito da conversa.
- `scrollContainer`: o elemento que faz scroll da conversa.
- `composerRoot`: o contentor que agrupa o campo do prompt e os seus botões de ação.
- `sendButton`: o botão que envia o prompt; alguns sites só o mostram quando o campo tem texto.

Um site declara apenas as chaves que consegue mesmo fornecer. Os plugins referenciam uma chave em vez de um seletor, escrevendo `{ "kind": "semantic", "key": "userTurn" }` como `target` de uma operação DOM, por isso uma remodelação do site resolve-se num único `site.json`.

`conversationIdPattern` é um campo separado do `site.json`, não um seletor: uma expressão regular sobre o caminho do URL cujo primeiro grupo de captura é o id da conversa, por exemplo `^/chat/([^/?#]+)`.

[Adicionando uma nova plataforma](./adding-a-platform.md)

## Âmbito do plugin

O âmbito deve seguir o problema do utilizador, não uma divisão mecânica por plataforma.

Um plugin do catálogo vive na pasta de um único site e todos os seus `matches` têm de estar cobertos pelo `site.json` dessa pasta (caso contrário, `bun run plugin:check` falha), por isso um mesmo plugin não pode cobrir Claude e ChatGPT. Quando uma funcionalidade serve várias plataformas, como largura de leitura, navegação entre páginas ou layout de blocos de código, publique um plugin por pasta de site (por exemplo `sites/claude/plugins/reading-width` e `sites/chatgpt/plugins/reading-width`) e mantenha nomes, definições e descrições consistentes.

Se cada plataforma exigir definições, lógica DOM ou textos muito diferentes, plugins separados serão mais claros. Não force funções sem relação num único plugin só para "cobrir tudo"; um plugin deve resolver um problema claro.

Regra rápida:

- Mesmo objetivo do utilizador, mesmas definições, só mudam os seletores: um plugin por pasta de site, com nomes e definições consistentes.
- Mesmo tema, mas experiência muito diferente por plataforma: pode separar, mantendo nomes e descrições relacionados.
- Objetivos diferentes: não junte.

## Evitar plugins duplicados

Antes de submeter, verifique os plugins oficiais existentes em [Todos os plugins](/pt/guide/plugins). Se já houver um bom plugin, melhore-o em vez de criar outro semelhante.

Um duplicado só deve ser aceite quando traz uma melhoria clara, por exemplo:

- Cobre uma plataforma importante que o plugin original não suporta.
- Corrige um problema de compatibilidade que o original não consegue resolver.
- Tem melhor desempenho, acessibilidade ou manutenção de forma clara.
- Oferece uma experiência de utilizador diferente e útil, não apenas outro nome ou pequenas alterações de estilo.

Assim a lista de plugins fica mais limpa e os utilizadores escolhem melhor.

## Exemplo mínimo

Não comece por um diretório vazio: `bun run plugin:new <id-segment> --site <site>` cria `catalog/sites/<site>/plugins/<id-segment>/` com um `plugin.json`, um `style.css` e um `README.md`, e acrescenta a entrada correspondente ao `marketplace.json`. O que gera é um ponto de partida, não uma aprovação; o manifest que vai preencher tem esta forma:

```json
{
  "$schema": "https://voyager.nagi.fun/plugin.schema.json",
  "id": "your-name.example-plugin",
  "name": "Example Plugin",
  "version": "1.0.0",
  "description": "A short description of what this plugin improves.",
  "author": "your-name",
  "category": "readability",
  "license": "MIT",
  "engine": ">=1.0.0",
  "tier": "declarative",
  "matches": ["https://claude.ai/*"],
  "contributes": {
    "styles": [{ "file": "style.css" }],
    "domOps": [
      {
        "op": "addClass",
        "target": "body",
        "className": "gv-plugin-example"
      }
    ]
  }
}
```

A linha `$schema` é opcional e serve apenas ao seu editor: aponta para o JSON Schema do manifest, para que este seja validado e completado enquanto escreve. O `site.json` tem o seu em `https://voyager.nagi.fun/site.schema.json`.

`style.css` pode ser escrito como CSS normal, mas recomenda-se que todos os estilos fiquem dentro da sua própria classe `gv-plugin-*`:

```css
.gv-plugin-example .some-target {
  max-width: 880px;
}
```

## Notas do manifest

- Use um prefixo de autor ou estilo de domínio inverso para `id`, como `your-name.reading-width`, para evitar conflitos.
- Mantenha `matches` restrito aos sites onde o plugin realmente precisa de funcionar.
- Um plugin só pode listar vários hosts em `matches` se o `site.json` do seu site os cobrir todos (por exemplo chatgpt.com e chat.openai.com); para cobrir outro site, adicione um plugin na pasta desse site.
- Valores recomendados para `category`: `render-fix`, `theme`, `layout`, `readability`, `productivity`, `integration` ou `other`.
- Indique em `engine` a versão mínima do Voyager de que o plugin precisa. Os plugins oficiais podem servir de exemplo.
- Adicione `i18n` para chinês, inglês e outras línguas comuns quando possível.

## Limites de CSS e recursos

Plugins declarativos são validados como entrada não confiável, por isso mantenha os recursos autocontidos:

- Não use `@import`.
- Não referencie imagens remotas, fontes externas ou CSS remoto.
- Pode usar CSS normal, propriedades personalizadas e substituições de valores de definições fornecidas pelo Voyager.
- Use o prefixo `gv-plugin-` nas classes para evitar poluir o site anfitrião ou o próprio Voyager.

Se o plugin precisar de definições, comece preferencialmente por valores numéricos. Por exemplo, um plugin de largura de leitura pode escrever o valor numa variável CSS e consumi-la no CSS.

[Limites das operações DOM](./dom-operation-boundaries.md)

## Quando não usar um plugin normal

Se a funcionalidade precisar de executar JavaScript, intercetar pedidos, ler ou escrever dados internos do Voyager, ou depender de lógica complexa em tempo de execução, não é adequada para um plugin declarativo normal.

Abra primeiro uma Issue e explique a necessidade. Se exigir mesmo uma capacidade integrada, podemos considerar implementá-la no repositório do Voyager como plugin builtin/native, como o Formula Copy.

## Antes de abrir uma PR

Execute `bun run plugin:check <diretório do plugin>` e cole a saída na PR. Comunica todos os problemas de uma vez: o manifest e o CSS, se `matches` sai do âmbito do site, as primitivas, as chaves semânticas, os dez idiomas e o README; a CI corre a mesma verificação sobre todos os plugins incluídos.

- O plugin está desativado por padrão e o utilizador ativa-o manualmente.
- Verificou que não existe um plugin quase igual; se existir, melhorou o plugin existente primeiro.
- Testou o site alvo em tema claro e escuro.
- `matches` não cobre sites sem relação.
- Não há referências a recursos remotos.
- O diretório do plugin contém `plugin.json`, os ficheiros CSS necessários e um README curto.
- Sendo um plugin oficial, o diretório está em `catalog/sites/<site>/plugins/<id>/`, os `matches` ficam dentro dos do site e `catalog/marketplace.json` lista-o (exceto os plugins do Gemini e do AI Studio, que vão dentro do Voyager).
- A PR descreve páginas de teste, capturas ou gravações, e as áreas de página afetadas.

Mantenha simples, focado e reversível. Um plugin que resolve um problema claro é muito mais fácil de fundir e manter.
