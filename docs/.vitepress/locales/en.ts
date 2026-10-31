import type { DefaultTheme, LocaleSpecificConfig } from 'vitepress';

import { announcementNav } from '../announcementNav';

const locale: LocaleSpecificConfig<DefaultTheme.Config> & { label: string; link?: string } = {
  label: 'English',
  lang: 'en-US',
  link: '/en/',
  description: 'Intuitive navigation. Powerful organization. Elegantly simple.',
  themeConfig: {
    nav: [
      ...announcementNav('Notice'),
      { text: 'Home', link: '/en/' },
      { text: 'Guide', link: '/en/guide/installation' },
      { text: 'Data Viewer', link: '/en/data-viewer' },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Installation', link: '/en/guide/installation' },
          { text: 'Getting Started', link: '/en/guide/getting-started' },
          { text: 'Voyager Panel', link: '/en/guide/panel' },
        ],
      },
      {
        text: 'Core Features',
        items: [
          { text: 'Folder Organization', link: '/en/guide/folders' },
          { text: 'Activity View', link: '/en/guide/activity-view' },
          { text: 'Prompt Library', link: '/en/guide/prompts' },
          { text: 'Cloud Sync', link: '/en/guide/cloud-sync' },
          { text: 'Timeline Navigation', link: '/en/guide/timeline' },
          { text: 'Chat Export', link: '/en/guide/export' },
          { text: 'Quote Reply', link: '/en/guide/quote-reply' },
          { text: 'Copy Canvas as Markdown', link: '/en/guide/canvas-copy' },
          { text: 'Send Behavior', link: '/en/guide/send-behavior' },
          { text: 'Formula Copy', link: '/en/guide/formula-copy' },
          { text: 'Sidebar Width', link: '/en/guide/sidebar' },
        ],
      },
      {
        text: 'Gemini & AI Studio',
        items: [
          { text: 'Conversation Fork (Experimental)', link: '/en/guide/fork' },
          { text: 'Make It Yours', link: '/en/guide/settings' },
          { text: 'Batch Delete', link: '/en/guide/batch-delete' },
          { text: 'Deep Research Export', link: '/en/guide/deep-research' },
          { text: 'Mermaid Diagram Rendering', link: '/en/guide/mermaid' },
          { text: 'Markdown Rendering Fix', link: '/en/guide/markdown-fix' },
          { text: 'Image Refinement (Watermark Removal)', link: '/en/guide/nanobanana' },
          { text: 'Sidebar Auto-hide', link: '/en/guide/sidebar-auto-hide' },
          { text: 'Prevent Auto Scroll', link: '/en/guide/prevent-auto-scroll' },
          { text: 'Input Collapse', link: '/en/guide/input-collapse' },
          { text: 'Recent Gems in Sidebar', link: '/en/guide/gems-sidebar' },
          { text: 'Usage Status Bar', link: '/en/guide/usage-status' },
          { text: 'Default Model', link: '/en/guide/default-model' },
          { text: 'Context Sync to IDE (Experimental)', link: '/en/guide/context-sync' },
          { text: 'User Message LaTeX Rendering', link: '/en/guide/user-latex' },
          { text: 'Message Timestamps', link: '/en/guide/timestamp' },
          { text: 'Font Size', link: '/en/guide/chat-font-size' },
        ],
      },
      {
        text: 'Plugins',
        items: [
          { text: 'All plugins', link: '/en/guide/plugins' },
          { text: 'ChatGPT Local Bridge', link: '/en/guide/local-bridge' },
          { text: 'Write Your Own Plugin', link: '/en/guide/write-a-plugin' },
          { text: 'Plugin Contribution', link: '/en/guide/plugin-contribution' },
          { text: 'Adding a new platform', link: '/en/guide/adding-a-platform' },
          { text: 'DOM operation boundaries', link: '/en/guide/dom-operation-boundaries' },
        ],
      },
      {
        text: 'Local Web UI',
        items: [{ text: 'DeepSeek Harness', link: '/en/guide/deepseek-harness' }],
      },
      {
        text: 'More',
        items: [
          { text: 'Community', link: '/en/guide/community' },
          { text: 'Sponsor', link: '/en/guide/sponsor' },
          { text: 'Ecosystem', link: '/en/guide/ecosystem' },
          { text: 'Changelog', link: '/en/changelog' },
        ],
      },
    ],
    footer: {
      message:
        'Open source project. Star us on <a href="https://github.com/voyager-crew/voyager" target="_blank">GitHub</a> if you like it ⭐.',
      copyright:
        'Released under the GPLv3 License | Copyright © 2026 Jesse Zhang | <a href="/en/privacy">Privacy Policy</a> | <a href="/en/changelog">Changelog</a>',
    },
  },
};

export default locale;
