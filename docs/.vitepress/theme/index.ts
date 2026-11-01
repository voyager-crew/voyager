import { NolebaseGitChangelogPlugin } from '@nolebase/vitepress-plugin-git-changelog/client';
import '@nolebase/vitepress-plugin-git-changelog/client/style.css';
import { type Theme, onContentUpdated } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { defineAsyncComponent, h } from 'vue';

import AnnouncementModal from './components/AnnouncementModal.vue';
import HomeAskAI from './components/HomeAskAI.vue';
import HomeReviews from './components/HomeReviews.vue';
import HomeTeaser from './components/HomeTeaser.vue';
import SafariDownloadLink from './components/SafariDownloadLink.vue';
import SiteSupport from './components/SiteSupport.vue';
import GuideFact from './components/guide/GuideFact.vue';
import GuideHero from './components/guide/GuideHero.vue';
import GuideOp from './components/guide/GuideOp';
import GuideShot from './components/guide/GuideShot.vue';
import { GuideFacts, GuideNote, GuideStep, GuideSteps } from './components/guide/wrappers';
import { HomeFeaturesLazy } from './components/homeFeatures/lazy';
import './guide.css';
import { localizeShortcutKeys } from './shortcutKeys';
import './style.css';

const GUIDE_BLOCKS = {
  GuideHero,
  GuideShot,
  GuideOp,
  GuideFacts,
  GuideFact,
  GuideSteps,
  GuideStep,
  GuideNote,
};

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      'layout-top': () => h(AnnouncementModal),
      'home-hero-after': () => h(HomeTeaser),
      'home-features-before': () => h(HomeFeaturesLazy),
      'home-features-after': () => [h(HomeAskAI), h(HomeReviews)],
    });
  },
  setup() {
    // Runs once the page content has mounted or changed, never during SSR or hydration.
    onContentUpdated(() => localizeShortcutKeys(document));
  },
  enhanceApp({ app }) {
    app.use(NolebaseGitChangelogPlugin);
    app.component('HomeReviews', HomeReviews);
    app.component('HomeTeaser', HomeTeaser);
    app.component('HomeAskAI', HomeAskAI);
    app.component('SafariDownloadLink', SafariDownloadLink);
    app.component('SiteSupport', SiteSupport);
    for (const [name, block] of Object.entries(GUIDE_BLOCKS)) app.component(name, block);
    // Only data-viewer.md uses it; loading it on demand keeps it out of every other page.
    // SSR still renders it in place.
    app.component(
      'FolderViewer',
      defineAsyncComponent(() => import('./components/FolderViewer.vue')),
    );
  },
} satisfies Theme;
