import type { DefaultTheme, LocaleSpecificConfig } from 'vitepress';

import { announcementNav } from '../announcementNav';

const locale: LocaleSpecificConfig<DefaultTheme.Config> & { label: string; link?: string } = {
  label: 'Português',
  lang: 'pt-PT',
  link: '/pt/',
  themeConfig: {
    nav: [
      ...announcementNav('Aviso'),
      { text: 'Início', link: '/pt/' },
      { text: 'Guia', link: '/pt/guide/installation' },
      { text: 'Visualizador', link: '/pt/data-viewer' },
    ],
    sidebar: [
      {
        text: 'Introdução',
        items: [
          { text: 'Instalação', link: '/pt/guide/installation' },
          { text: 'Começar', link: '/pt/guide/getting-started' },
          { text: 'Painel do Voyager', link: '/pt/guide/panel' },
        ],
      },
      {
        text: 'Funcionalidades principais',
        items: [
          { text: 'Pastas', link: '/pt/guide/folders' },
          { text: 'Vista Activity', link: '/pt/guide/activity-view' },
          { text: 'Biblioteca de Prompts', link: '/pt/guide/prompts' },
          { text: 'Sincronização na Nuvem', link: '/pt/guide/cloud-sync' },
          { text: 'Navegação na Linha do Tempo', link: '/pt/guide/timeline' },
          { text: 'Exportação de Chat', link: '/pt/guide/export' },
          { text: 'Resposta com Citação', link: '/pt/guide/quote-reply' },
          { text: 'Copiar Canvas como Markdown', link: '/pt/guide/canvas-copy' },
          { text: 'Comportamento de Envio', link: '/pt/guide/send-behavior' },
          { text: 'Cópia de Fórmulas', link: '/pt/guide/formula-copy' },
          { text: 'Largura da barra lateral', link: '/pt/guide/sidebar' },
        ],
      },
      {
        text: 'Gemini & AI Studio',
        items: [
          { text: 'Bifurcação de Conversa (Experimental)', link: '/pt/guide/fork' },
          { text: 'À Sua Maneira', link: '/pt/guide/settings' },
          { text: 'Exclusão em Lote', link: '/pt/guide/batch-delete' },
          { text: 'Exportação Deep Research', link: '/pt/guide/deep-research' },
          { text: 'Gráficos Mermaid', link: '/pt/guide/mermaid' },
          { text: 'Correção de Renderização Markdown', link: '/pt/guide/markdown-fix' },
          { text: 'NanoBanana', link: '/pt/guide/nanobanana' },
          { text: 'Ocultar barra lateral auto', link: '/pt/guide/sidebar-auto-hide' },
          { text: 'Prevenir rolamento automático', link: '/pt/guide/prevent-auto-scroll' },
          { text: 'Colapso de Entrada', link: '/pt/guide/input-collapse' },
          {
            text: 'Gems recentes na barra lateral',
            link: '/pt/guide/gems-sidebar',
          },
          { text: 'Barra de status de uso', link: '/pt/guide/usage-status' },
          { text: 'Modelo Padrão', link: '/pt/guide/default-model' },
          { text: 'Sincronização de Contexto (Experimental)', link: '/pt/guide/context-sync' },
          { text: 'Renderização LaTeX de mensagens', link: '/pt/guide/user-latex' },
          { text: 'Carimbo de Data/Hora', link: '/pt/guide/timestamp' },
          { text: 'Tamanho da Fonte', link: '/pt/guide/chat-font-size' },
        ],
      },
      {
        text: 'Plugins',
        items: [
          { text: 'Todos os plugins', link: '/pt/guide/plugins' },
          { text: 'Ponte local do ChatGPT', link: '/pt/guide/local-bridge' },
          { text: 'Escreva o seu próprio plugin', link: '/pt/guide/write-a-plugin' },
          { text: 'Contribuir plugins', link: '/pt/guide/plugin-contribution' },
          { text: 'Adicionando uma nova plataforma', link: '/pt/guide/adding-a-platform' },
          { text: 'Limites das operações DOM', link: '/pt/guide/dom-operation-boundaries' },
        ],
      },
      {
        text: 'Interface Web local',
        items: [{ text: 'DeepSeek Harness', link: '/pt/guide/deepseek-harness' }],
      },
      {
        text: 'Mais',
        items: [
          { text: 'Comunidade', link: '/pt/guide/community' },
          { text: 'Patrocinar', link: '/pt/guide/sponsor' },
          { text: 'Ecossistema', link: '/pt/guide/ecosystem' },
          { text: 'Novidades', link: '/pt/changelog' },
        ],
      },
    ],
    footer: {
      message:
        'Projeto Open Source. Dê uma ⭐ no <a href="https://github.com/voyager-crew/voyager" target="_blank">GitHub</a> se você gostar.',
      copyright:
        'Licença GPLv3 | Copyright © 2026 Jesse Zhang | <a href="/pt/privacy">Política de Privacidade</a> | <a href="/pt/changelog">Novidades</a>',
    },
  },
};

export default locale;
