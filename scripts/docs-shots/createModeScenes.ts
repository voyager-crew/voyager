/** The words and creations each language's Create mode screenshots use. */

export type Lang = 'zh' | 'en';

interface Manifest {
  [key: string]: unknown;
}

function declarative(id: string, name: string, description: string, contributes: object): Manifest {
  return {
    id,
    name,
    version: '1.0.0',
    description,
    author: 'me',
    category: 'layout',
    license: 'MIT',
    engine: '>=1.0.0',
    tier: 'declarative',
    matches: ['https://gemini.google.com/*'],
    contributes,
  };
}

const NARROW = (name: string, description: string) =>
  declarative('me.narrow-chat', name, description, {
    styles: [
      {
        css: '.gv-plugin-narrow-chat{max-width:640px;margin-inline:auto}\n.gv-plugin-narrow-side{display:none!important}',
      },
    ],
    domOps: [
      {
        op: 'addClass',
        target: { kind: 'semantic', key: 'userTurn' },
        className: 'gv-plugin-narrow-chat',
      },
      {
        op: 'addClass',
        target: { kind: 'semantic', key: 'sidebar' },
        className: 'gv-plugin-narrow-side',
      },
    ],
  });

const CORNERS = (name: string, description: string) =>
  declarative('me.round-code', name, description, {
    styles: [{ css: '.gv-plugin-round-code{border-radius:20px!important;overflow:hidden}' }],
    domOps: [
      {
        op: 'addClass',
        target: { kind: 'semantic', key: 'codeBlock' },
        className: 'gv-plugin-round-code',
      },
    ],
  });

/** Aims at a banner this page does not have, as after a site redesign. */
const BANNER = (name: string, description: string) =>
  declarative('me.hide-banner', name, description, {
    styles: [{ css: '.gv-plugin-hide-banner{display:none!important}' }],
    domOps: [
      {
        op: 'addClass',
        target: { kind: 'css', selector: '.promo-banner' },
        className: 'gv-plugin-hide-banner',
      },
    ],
  });

const COUNTER = (name: string, description: string, label: string) => ({
  ...declarative('me.message-count', name, description, {}),
  tier: 'scripted',
  contributes: {
    script: {
      source: `// ${description}\nconst badge = document.createElement('div');\nbadge.className = 'gv-plugin-message-count';\nObject.assign(badge.style, { position: 'fixed', left: '16px', bottom: '16px', font: '12px system-ui' });\ndocument.body.append(badge);\nsetInterval(() => {\n  badge.textContent = \`${label} \${document.querySelectorAll('user-query').length}\`;\n}, 1000);\n`,
    },
  },
});

export const SCENES = {
  zh: {
    request: '让我的消息窄一点，并隐藏侧边栏',
    narrow: NARROW('消息窄一点，隐藏侧边栏', '把对话区收窄，并隐藏左侧边栏。'),
    narrowIntro: '好的，这是让消息变窄并隐藏侧边栏的插件：',
    corners: CORNERS('代码块圆角', '把代码块的四个角改得更圆。'),
    cornersAsk: '把代码块的四个角改得更圆一点',
    banner: BANNER('隐藏顶部横幅', '隐藏页面顶部的推广横幅。'),
    bannerAsk: '把顶部的推广横幅藏起来',
    counter: COUNTER('消息计数', '在左下角显示这个对话里我发了几条消息。', '我的消息：'),
    counterAsk: '在角落里显示我发了几条消息',
    again: '再窄一点',
    replyIntro: '这是新版本：',
    labels: {
      create: '在此页创造',
      install: '安装并开启',
      close: '关闭',
      cancel: '取消',
    },
  },
  en: {
    request: 'Make my messages narrower and hide the sidebar',
    narrow: NARROW(
      'Narrow messages, no sidebar',
      'Narrows the conversation and hides the left sidebar.',
    ),
    narrowIntro: 'Here is a plugin that narrows your messages and hides the sidebar:',
    corners: CORNERS('Rounder code blocks', 'Gives code blocks rounder corners.'),
    cornersAsk: 'Give code blocks rounder corners',
    banner: BANNER('Hide the top banner', 'Hides the promo banner at the top of the page.'),
    bannerAsk: 'Hide the promo banner at the top',
    counter: COUNTER(
      'Message counter',
      'Shows how many messages I sent in this chat, bottom left.',
      'My messages:',
    ),
    counterAsk: 'Show how many messages I have sent, in a corner',
    again: 'A bit narrower',
    replyIntro: 'Here is the new version:',
    labels: {
      create: 'Create on this page',
      install: 'Install and turn on',
      close: 'Close',
      cancel: 'Cancel',
    },
  },
} as const;

export const json = (value: unknown) => JSON.stringify(value, null, 2);
