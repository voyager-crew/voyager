# Liberdade Total

O Exportar do Voyager permite baixar qualquer conversa do Gemini, ChatGPT, Claude, DeepSeek ou Kimi como arquivo Markdown, PDF, JSON ou imagem. Ele extrai todo o conteúdo do chat, incluindo blocos de código, imagens e formatação, e lhe dá uma cópia permanente e portátil de cada conversa com IA que você já teve.

Aprisionamento de dados é o inimigo.
Acreditamos que, se você criou, você é dono.

## Comparação de formatos

| Recurso            | Markdown                         | PDF                      | JSON                              | Imagem                   |
| ------------------ | -------------------------------- | ------------------------ | --------------------------------- | ------------------------ |
| Ideal para         | Apps de notas (Obsidian, Notion) | Compartilhar e imprimir  | Desenvolvedores, análise de dados | Compartilhar no celular  |
| Imagens            | Incorporadas                     | Totalmente incluídas     | Codificadas em Base64             | Renderizadas no lugar    |
| Blocos de código   | Preservados com sintaxe          | Renderizados visualmente | Texto bruto preservado            | Renderizados visualmente |
| Tamanho do arquivo | O menor                          | O maior                  | Médio                             | Grande                   |
| Pesquisável        | Texto simples                    | Busca do leitor de PDF   | Acesso programático               | Não                      |

## Exporte tudo

O Voyager permite tirar os seus dados da nuvem e colocá-los nas suas mãos.

### Os formatos

- **Markdown**: Para o seu cofre do Obsidian ou Notion. Texto limpo e formatado com imagens incorporadas.
- **PDF**: Para compartilhar ou imprimir. Diagramação bonita, com imagens incluídas.
- **JSON**: Dados brutos. Para desenvolvedores que querem construir algo em cima do seu histórico.
- **Imagem**: Um PNG longo, ótimo para compartilhar no celular. Escolha um layout estreito, médio ou largo.

### Como exportar

1. Clique no botão **Exportar** (ChatGPT, Claude, DeepSeek, Kimi e os layouts atuais do Gemini). Ele começa no canto superior direito da página; arraste-o para onde quiser, cada site lembra a posição e, se você soltá-lo perto da posição padrão, ele volta para lá. No Gemini, você também pode escolher **Exportar histórico da conversa** no menu ⋮ de uma conversa ou de uma resposta; nos layouts antigos do Gemini, passe o mouse sobre o logo do Gemini para ver o **Ícone de Exportação**.
2. Escolha o formato.
3. Pronto.

No Claude, DeepSeek e Kimi, a exportação é um plugin desativado por padrão: ative-o primeiro em **Plugins** no popup. O Voyager rola as conversas longas para ler tudo e depois começa com todas as mensagens selecionadas; desmarque as que não quiser. Se não conseguir confirmar o início e o fim, ele avisa que a exportação pode estar incompleta. No ChatGPT, se não conseguir ler o histórico completo, ele avisa e pede que você role para cima para carregar as mensagens anteriores e tente novamente. Mudar para outro chat interrompe a exportação, assim como uma nova resposta começando no Claude.

Os arquivos enviados em uma conversa do ChatGPT aparecem na exportação como uma linha `📎 nome do arquivo`.

Os dados são seus. Faça o que quiser com eles.

<div style="display: flex; gap: 20px; margin-top: 20px;">
  <div style="flex: 1; text-align: center;">
    <p><b>Passo 1: Encontre o Exportar</b></p>
    <img src="/assets/gemini-export-guide-1.png" alt="Guia de exportação, passo 1" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"/>
  </div>
  <div style="flex: 1; text-align: center;">
    <p><b>Passo 2: A escolha</b></p>
    <img src="/assets/gemini-export-guide-2.png" alt="Guia de exportação, passo 2" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"/>
  </div>
</div>

### Nota sobre exportação de PDF no Safari

Exportar PDF no Safari exige um processo um pouco diferente (impressão manual):

1. Clique no botão **Exportar** e selecione o formato PDF.
2. **Aguarde cerca de um segundo** (para a página preparar os estilos de impressão).
3. Pressione `Command + P` para abrir a caixa de diálogo de impressão.
4. Selecione **"Salvar como PDF"** na caixa de diálogo de impressão.

<img src="/assets/safari-export-pdf.png" alt="Exportar PDF no Safari" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-top: 20px;"/>

## Exportação do Deep Research

O modo Deep Research do Gemini produz relatórios estruturados, com fontes, etapas de raciocínio e citações. O Voyager pode exportar essas sessões com todos os metadados preservados:

1. Abra uma conversa de Deep Research já concluída.
2. Abra o menu **Share & Export** do relatório e escolha **Save Report**.
3. Escolha o formato.
4. A exportação inclui o relatório final com os links das fontes. Para salvar também o processo de raciocínio, veja [Exportação do Deep Research](/pt/guide/deep-research).

Isso é útil para pesquisa acadêmica, análise competitiva e documentação técnica, quando você precisa preservar a cadeia de raciocínio e a atribuição das fontes.

## Quando exportar

- **Arquivamento de conhecimento**: Salve conversas importantes antes que sejam enterradas no seu histórico.
- **Compartilhamento com a equipe**: Exporte uma sessão de depuração em PDF para compartilhar com colegas que não usam o Gemini.
- **Montar uma base de conhecimento**: Exporte conversas em Markdown e organize-as no Obsidian ou no Notion.
- **Análise de dados**: Use exportações em JSON para analisar padrões de conversa de forma programática ou extrair dados estruturados.
- **Conformidade e auditoria**: Mantenha registros de decisões assistidas por IA para trilhas de auditoria.

## Plataformas compatíveis

A exportação funciona no Gemini e no ChatGPT, nos navegadores Chrome, Edge, Firefox, Safari, Opera e Brave. No Claude, DeepSeek e Kimi, a exportação é um plugin desativado por padrão, que você ativa em **Plugins**. No Safari, a exportação em PDF usa uma etapa de impressão manual (Command+P depois de clicar em exportar); as exportações em Markdown e JSON continuam incluindo imagens.
