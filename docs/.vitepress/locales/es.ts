import type { DefaultTheme, LocaleSpecificConfig } from 'vitepress';

import { announcementNav } from '../announcementNav';

const locale: LocaleSpecificConfig<DefaultTheme.Config> & { label: string; link?: string } = {
  label: 'Español',
  lang: 'es-ES',
  link: '/es/',
  themeConfig: {
    nav: [
      ...announcementNav('Aviso'),
      { text: 'Inicio', link: '/es/' },
      { text: 'Guía', link: '/es/guide/installation' },
      { text: 'Visor', link: '/es/data-viewer' },
    ],
    sidebar: [
      {
        text: 'Introducción',
        items: [
          { text: 'Instalación', link: '/es/guide/installation' },
          { text: 'Comenzar', link: '/es/guide/getting-started' },
          { text: 'Panel de Voyager', link: '/es/guide/panel' },
        ],
      },
      {
        text: 'Funciones principales',
        items: [
          { text: 'Carpetas', link: '/es/guide/folders' },
          { text: 'Vista Activity', link: '/es/guide/activity-view' },
          { text: 'Biblioteca de Prompts', link: '/es/guide/prompts' },
          { text: 'Sincronización en la Nube', link: '/es/guide/cloud-sync' },
          { text: 'Navegación de Línea de Tiempo', link: '/es/guide/timeline' },
          { text: 'Exportación de Chat', link: '/es/guide/export' },
          { text: 'Respuesta con Cita', link: '/es/guide/quote-reply' },
          { text: 'Copiar Canvas como Markdown', link: '/es/guide/canvas-copy' },
          { text: 'Comportamiento de Envío', link: '/es/guide/send-behavior' },
          { text: 'Copia de Fórmulas', link: '/es/guide/formula-copy' },
          { text: 'Ancho de la barra lateral', link: '/es/guide/sidebar' },
        ],
      },
      {
        text: 'Gemini & AI Studio',
        items: [
          {
            text: 'Bifurcación de Conversación (Experimental)',
            link: '/es/guide/fork',
          },
          { text: 'A Tu Gusto', link: '/es/guide/settings' },
          { text: 'Eliminación por Lote', link: '/es/guide/batch-delete' },
          { text: 'Exportación Deep Research', link: '/es/guide/deep-research' },
          { text: 'Gráficos Mermaid', link: '/es/guide/mermaid' },
          { text: 'Corrección de Renderizado Markdown', link: '/es/guide/markdown-fix' },
          { text: 'NanoBanana', link: '/es/guide/nanobanana' },
          { text: 'Ocultar barra lateral auto', link: '/es/guide/sidebar-auto-hide' },
          { text: 'Evitar desplazamiento automático', link: '/es/guide/prevent-auto-scroll' },
          { text: 'Colapso de Entrada', link: '/es/guide/input-collapse' },
          {
            text: 'Gems recientes en la barra lateral',
            link: '/es/guide/gems-sidebar',
          },
          { text: 'Barra de estado de uso', link: '/es/guide/usage-status' },
          { text: 'Modelo Predeterminado', link: '/es/guide/default-model' },
          {
            text: 'Sincronización de contexto a IDE (Experimental)',
            link: '/es/guide/context-sync',
          },
          { text: 'Renderizado LaTeX de mensajes', link: '/es/guide/user-latex' },
          { text: 'Marca de Tiempo', link: '/es/guide/timestamp' },
          { text: 'Tamaño de Fuente', link: '/es/guide/chat-font-size' },
        ],
      },
      {
        text: 'Plugins',
        items: [
          { text: 'Todos los plugins', link: '/es/guide/plugins' },
          { text: 'Puente local de ChatGPT', link: '/es/guide/local-bridge' },
          { text: 'Escribe tu propio plugin', link: '/es/guide/write-a-plugin' },
          { text: 'Contribuir plugins', link: '/es/guide/plugin-contribution' },
          { text: 'Añadir una nueva plataforma', link: '/es/guide/adding-a-platform' },
          { text: 'Límites de operaciones DOM', link: '/es/guide/dom-operation-boundaries' },
        ],
      },
      {
        text: 'Interfaz Web local',
        items: [{ text: 'DeepSeek Harness', link: '/es/guide/deepseek-harness' }],
      },
      {
        text: 'Más',
        items: [
          { text: 'Comunidad', link: '/es/guide/community' },
          { text: 'Patrocinar', link: '/es/guide/sponsor' },
          { text: 'Ecosistema', link: '/es/guide/ecosystem' },
          { text: 'Novedades', link: '/es/changelog' },
        ],
      },
    ],
    footer: {
      message:
        'Proyecto de Código Abierto. Danos una ⭐ en <a href="https://github.com/voyager-crew/voyager" target="_blank">GitHub</a> si te gusta.',
      copyright:
        'Licencia GPLv3 | Copyright © 2026 Jesse Zhang | <a href="/es/privacy">Política de Privacidad</a> | <a href="/es/changelog">Novedades</a>',
    },
  },
};

export default locale;
