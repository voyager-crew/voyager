import type { DefaultTheme, LocaleSpecificConfig } from 'vitepress';

import { announcementNav } from '../announcementNav';

const locale: LocaleSpecificConfig<DefaultTheme.Config> & { label: string; link?: string } = {
  label: '日本語',
  lang: 'ja-JP',
  link: '/ja/',
  themeConfig: {
    nav: [
      ...announcementNav('お知らせ'),
      { text: 'ホーム', link: '/ja/' },
      { text: 'ガイド', link: '/ja/guide/installation' },
      { text: 'データビューア', link: '/ja/data-viewer' },
    ],
    sidebar: [
      {
        text: 'はじめに',
        items: [
          { text: 'インストール', link: '/ja/guide/installation' },
          { text: 'クイックスタート', link: '/ja/guide/getting-started' },
          { text: 'Voyager パネル', link: '/ja/guide/panel' },
        ],
      },
      {
        text: 'コア機能',
        items: [
          { text: 'フォルダ管理', link: '/ja/guide/folders' },
          { text: 'Activityビュー', link: '/ja/guide/activity-view' },
          { text: 'プロンプト', link: '/ja/guide/prompts' },
          { text: 'クラウド同期', link: '/ja/guide/cloud-sync' },
          { text: 'タイムライン', link: '/ja/guide/timeline' },
          { text: 'エクスポート', link: '/ja/guide/export' },
          { text: '引用返信', link: '/ja/guide/quote-reply' },
          { text: 'CanvasをMarkdownとしてコピー', link: '/ja/guide/canvas-copy' },
          { text: '送信動作', link: '/ja/guide/send-behavior' },
          { text: '数式コピー', link: '/ja/guide/formula-copy' },
          { text: 'サイドバーの幅', link: '/ja/guide/sidebar' },
        ],
      },
      {
        text: 'Gemini & AI Studio',
        items: [
          { text: '会話の分岐 (実験的)', link: '/ja/guide/fork' },
          { text: '思うがままに', link: '/ja/guide/settings' },
          { text: '一括削除', link: '/ja/guide/batch-delete' },
          { text: 'Deep Research', link: '/ja/guide/deep-research' },
          { text: 'Mermaid', link: '/ja/guide/mermaid' },
          { text: 'Markdown レンダリングの修正', link: '/ja/guide/markdown-fix' },
          { text: 'NanoBanana', link: '/ja/guide/nanobanana' },
          { text: 'サイドバー自動非表示', link: '/ja/guide/sidebar-auto-hide' },
          { text: '自動スクロール防止', link: '/ja/guide/prevent-auto-scroll' },
          { text: '入力欄の自動非表示', link: '/ja/guide/input-collapse' },
          { text: 'サイドバーの最近の Gems', link: '/ja/guide/gems-sidebar' },
          { text: '使用量ステータスバー', link: '/ja/guide/usage-status' },
          { text: 'デフォルトモデル', link: '/ja/guide/default-model' },
          { text: 'IDEへのコンテキスト同期（実験的）', link: '/ja/guide/context-sync' },
          { text: 'ユーザーメッセージ LaTeX レンダリング', link: '/ja/guide/user-latex' },
          { text: 'メッセージタイムスタンプ', link: '/ja/guide/timestamp' },
          { text: 'フォントサイズ', link: '/ja/guide/chat-font-size' },
        ],
      },
      {
        text: 'プラグイン',
        items: [
          { text: 'プラグイン一覧', link: '/ja/guide/plugins' },
          { text: 'ChatGPT ローカルブリッジ', link: '/ja/guide/local-bridge' },
          { text: '自分でプラグインを作る', link: '/ja/guide/write-a-plugin' },
          { text: 'プラグイン貢献ガイド', link: '/ja/guide/plugin-contribution' },
          { text: '新しいプラットフォームを追加する', link: '/ja/guide/adding-a-platform' },
          { text: 'DOM 操作の範囲', link: '/ja/guide/dom-operation-boundaries' },
        ],
      },
      {
        text: 'ローカル Web UI',
        items: [{ text: 'DeepSeek Harness', link: '/ja/guide/deepseek-harness' }],
      },
      {
        text: 'その他',
        items: [
          { text: 'コミュニティ', link: '/ja/guide/community' },
          { text: 'スポンサー', link: '/ja/guide/sponsor' },
          { text: 'エコシステム', link: '/ja/guide/ecosystem' },
          { text: '更新履歴', link: '/ja/changelog' },
        ],
      },
    ],
    footer: {
      message:
        'オープンソースプロジェクトです。<a href="https://github.com/voyager-crew/voyager" target="_blank">GitHub</a> でスター ⭐ をつけて応援してください。',
      copyright:
        'GPLv3 ライセンス | Copyright © 2026 Jesse Zhang | <a href="/ja/privacy">プライバシーポリシー</a> | <a href="/ja/changelog">更新履歴</a>',
    },
  },
};

export default locale;
