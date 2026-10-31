import type { DefaultTheme, LocaleSpecificConfig } from 'vitepress';

import { announcementNav } from '../announcementNav';

const locale: LocaleSpecificConfig<DefaultTheme.Config> & { label: string; link?: string } = {
  label: 'Français',
  lang: 'fr-FR',
  link: '/fr/',
  themeConfig: {
    nav: [
      ...announcementNav('Annonce'),
      { text: 'Accueil', link: '/fr/' },
      { text: 'Guide', link: '/fr/guide/installation' },
      { text: 'Visionneuse', link: '/fr/data-viewer' },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Installation', link: '/fr/guide/installation' },
          { text: 'Commencer', link: '/fr/guide/getting-started' },
          { text: 'Panneau Voyager', link: '/fr/guide/panel' },
        ],
      },
      {
        text: 'Fonctionnalités principales',
        items: [
          { text: 'Dossiers', link: '/fr/guide/folders' },
          { text: 'Vue Activity', link: '/fr/guide/activity-view' },
          { text: 'Bibliothèque de Prompts', link: '/fr/guide/prompts' },
          { text: 'Synchronisation Cloud', link: '/fr/guide/cloud-sync' },
          { text: 'Navigation Temporelle', link: '/fr/guide/timeline' },
          { text: 'Export de Chat', link: '/fr/guide/export' },
          { text: 'Réponse avec Citation', link: '/fr/guide/quote-reply' },
          { text: 'Copier un document Canvas en Markdown', link: '/fr/guide/canvas-copy' },
          { text: "Comportement d'Envoi", link: '/fr/guide/send-behavior' },
          { text: 'Copie de Formules', link: '/fr/guide/formula-copy' },
          { text: 'Largeur de la barre latérale', link: '/fr/guide/sidebar' },
        ],
      },
      {
        text: 'Gemini & AI Studio',
        items: [
          { text: 'Bifurcation de Conversation (Expérimental)', link: '/fr/guide/fork' },
          { text: 'Appropriez-le-vous', link: '/fr/guide/settings' },
          { text: 'Suppression par Lot', link: '/fr/guide/batch-delete' },
          { text: 'Export Deep Research', link: '/fr/guide/deep-research' },
          { text: 'Diagrammes Mermaid', link: '/fr/guide/mermaid' },
          { text: 'Correction du Rendu Markdown', link: '/fr/guide/markdown-fix' },
          { text: 'NanoBanana', link: '/fr/guide/nanobanana' },
          { text: 'Masquage auto barre latérale', link: '/fr/guide/sidebar-auto-hide' },
          { text: 'Empêcher le défilement auto', link: '/fr/guide/prevent-auto-scroll' },
          { text: 'Réduction Entrée', link: '/fr/guide/input-collapse' },
          {
            text: 'Gems récents dans la barre latérale',
            link: '/fr/guide/gems-sidebar',
          },
          { text: 'Barre de statut d’usage', link: '/fr/guide/usage-status' },
          { text: 'Modèle par Défaut', link: '/fr/guide/default-model' },
          { text: 'Synchro Contexte IDE', link: '/fr/guide/context-sync' },
          { text: 'Rendu LaTeX des messages', link: '/fr/guide/user-latex' },
          { text: 'Horodatage des Messages', link: '/fr/guide/timestamp' },
          { text: 'Taille de Police', link: '/fr/guide/chat-font-size' },
        ],
      },
      {
        text: 'Plugins',
        items: [
          { text: 'Tous les plugins', link: '/fr/guide/plugins' },
          { text: 'Pont local ChatGPT', link: '/fr/guide/local-bridge' },
          { text: 'Écrire son propre plugin', link: '/fr/guide/write-a-plugin' },
          { text: 'Contribution Plugins', link: '/fr/guide/plugin-contribution' },
          { text: 'Ajouter une nouvelle plateforme', link: '/fr/guide/adding-a-platform' },
          { text: 'Limites des opérations DOM', link: '/fr/guide/dom-operation-boundaries' },
        ],
      },
      {
        text: 'Interface Web locale',
        items: [{ text: 'DeepSeek Harness', link: '/fr/guide/deepseek-harness' }],
      },
      {
        text: 'Plus',
        items: [
          { text: 'Communauté', link: '/fr/guide/community' },
          { text: 'Sponsor', link: '/fr/guide/sponsor' },
          { text: 'Écosystème', link: '/fr/guide/ecosystem' },
          { text: 'Nouveautés', link: '/fr/changelog' },
        ],
      },
    ],
    footer: {
      message:
        'Projet Open Source. Mettez une ⭐ sur <a href="https://github.com/voyager-crew/voyager" target="_blank">GitHub</a> si vous aimez.',
      copyright:
        'Licence GPLv3 | Copyright © 2026 Jesse Zhang | <a href="/fr/privacy">Politique de Confidentialité</a> | <a href="/fr/changelog">Nouveautés</a>',
    },
  },
};

export default locale;
