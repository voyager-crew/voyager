import type { DefaultTheme, LocaleSpecificConfig } from 'vitepress';

import { announcementNav } from '../announcementNav';

const locale: LocaleSpecificConfig<DefaultTheme.Config> & { label: string; link?: string } = {
  label: '繁體中文',
  lang: 'zh-TW',
  link: '/zh_TW/',
  themeConfig: {
    nav: [
      ...announcementNav('重要通知'),
      { text: '首頁', link: '/zh_TW/' },
      { text: '指南', link: '/zh_TW/guide/installation' },
      { text: '資料查看器', link: '/zh_TW/data-viewer' },
    ],
    sidebar: [
      {
        text: '介紹',
        items: [
          { text: '安裝', link: '/zh_TW/guide/installation' },
          { text: '快速開始', link: '/zh_TW/guide/getting-started' },
          { text: 'Voyager 面板', link: '/zh_TW/guide/panel' },
        ],
      },
      {
        text: '核心功能',
        items: [
          { text: '資料夾', link: '/zh_TW/guide/folders' },
          { text: 'Activity 注意力檢視', link: '/zh_TW/guide/activity-view' },
          { text: '提示詞庫', link: '/zh_TW/guide/prompts' },
          { text: '雲同步', link: '/zh_TW/guide/cloud-sync' },
          { text: '時間軸導航', link: '/zh_TW/guide/timeline' },
          { text: '對話導出', link: '/zh_TW/guide/export' },
          { text: '引用回覆', link: '/zh_TW/guide/quote-reply' },
          { text: '將 Canvas 複製為 Markdown', link: '/zh_TW/guide/canvas-copy' },
          { text: '傳送行為', link: '/zh_TW/guide/send-behavior' },
          { text: '公式複製', link: '/zh_TW/guide/formula-copy' },
          { text: '側邊欄寬度', link: '/zh_TW/guide/sidebar' },
        ],
      },
      {
        text: 'Gemini & AI Studio',
        items: [
          { text: '對話分支 (實驗性)', link: '/zh_TW/guide/fork' },
          { text: '隨心所欲', link: '/zh_TW/guide/settings' },
          { text: '批次刪除', link: '/zh_TW/guide/batch-delete' },
          { text: 'Deep Research 導出', link: '/zh_TW/guide/deep-research' },
          { text: 'Mermaid 圖表', link: '/zh_TW/guide/mermaid' },
          { text: 'Markdown 渲染修復', link: '/zh_TW/guide/markdown-fix' },
          { text: 'NanoBanana', link: '/zh_TW/guide/nanobanana' },
          { text: '側邊欄自動收起', link: '/zh_TW/guide/sidebar-auto-hide' },
          { text: '防自動跳轉', link: '/zh_TW/guide/prevent-auto-scroll' },
          { text: '輸入框摺疊', link: '/zh_TW/guide/input-collapse' },
          { text: '側欄 Gems 列表', link: '/zh_TW/guide/gems-sidebar' },
          { text: '用量狀態列', link: '/zh_TW/guide/usage-status' },
          { text: '預設模型', link: '/zh_TW/guide/default-model' },
          { text: '上下文同步（實驗性）', link: '/zh_TW/guide/context-sync' },
          { text: '使用者訊息 LaTeX 渲染', link: '/zh_TW/guide/user-latex' },
          { text: '訊息時間戳', link: '/zh_TW/guide/timestamp' },
          { text: '字體大小', link: '/zh_TW/guide/chat-font-size' },
        ],
      },
      {
        text: '外掛',
        items: [
          { text: '外掛一覽', link: '/zh_TW/guide/plugins' },
          { text: 'ChatGPT 本機橋接', link: '/zh_TW/guide/local-bridge' },
          { text: '撰寫自己的外掛', link: '/zh_TW/guide/write-a-plugin' },
          { text: '外掛貢獻說明', link: '/zh_TW/guide/plugin-contribution' },
          { text: '新增平台', link: '/zh_TW/guide/adding-a-platform' },
          { text: 'DOM 操作邊界', link: '/zh_TW/guide/dom-operation-boundaries' },
        ],
      },
      {
        text: '本機 Web UI',
        items: [{ text: 'DeepSeek Harness', link: '/zh_TW/guide/deepseek-harness' }],
      },
      {
        text: '更多',
        items: [
          { text: '社群', link: '/zh_TW/guide/community' },
          { text: '贊助', link: '/zh_TW/guide/sponsor' },
          { text: '受 Voyager 啟發的項目', link: '/zh_TW/guide/ecosystem' },
          { text: '更新日誌', link: '/zh_TW/changelog' },
        ],
      },
    ],
    footer: {
      message:
        '開源專案。如果您喜歡，請在 <a href="https://github.com/voyager-crew/voyager" target="_blank">GitHub</a> 上給我們一顆 ⭐。',
      copyright:
        'GPLv3 授權 | Copyright © 2026 Jesse Zhang | <a href="/zh_TW/privacy">隱私政策</a> | <a href="/zh_TW/changelog">更新日誌</a>',
    },
  },
};

export default locale;
