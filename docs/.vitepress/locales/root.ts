import type { DefaultTheme, LocaleSpecificConfig } from 'vitepress';

import { announcementNav } from '../announcementNav';

const locale: LocaleSpecificConfig<DefaultTheme.Config> & { label: string; link?: string } = {
  label: '简体中文',
  lang: 'zh-CN',
  themeConfig: {
    nav: [
      ...announcementNav('重要通知'),
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/installation' },
      { text: '数据查看器', link: '/data-viewer' },
    ],
    sidebar: [
      {
        text: '启程',
        items: [
          { text: '安装', link: '/guide/installation' },
          { text: '快速上手', link: '/guide/getting-started' },
          { text: 'Voyager 面板', link: '/guide/panel' },
        ],
      },
      {
        text: '核心功能',
        items: [
          { text: '文件夹', link: '/guide/folders' },
          { text: 'Activity 注意力视图', link: '/guide/activity-view' },
          { text: '灵感库', link: '/guide/prompts' },
          { text: '云同步', link: '/guide/cloud-sync' },
          { text: '时间轴', link: '/guide/timeline' },
          { text: '对话导出', link: '/guide/export' },
          { text: '引用回复', link: '/guide/quote-reply' },
          { text: 'Canvas 复制为 Markdown', link: '/guide/canvas-copy' },
          { text: '发送行为', link: '/guide/send-behavior' },
          { text: '公式复制', link: '/guide/formula-copy' },
          { text: '侧边栏宽度', link: '/guide/sidebar' },
        ],
      },
      {
        text: 'Gemini & AI Studio',
        items: [
          { text: '对话分支 (实验性)', link: '/guide/fork' },
          { text: '随心所欲', link: '/guide/settings' },
          { text: '批量删除', link: '/guide/batch-delete' },
          { text: 'Deep Research 导出', link: '/guide/deep-research' },
          { text: 'Mermaid 图表渲染', link: '/guide/mermaid' },
          { text: 'Markdown 渲染修复', link: '/guide/markdown-fix' },
          { text: 'NanoBanana 水印去除', link: '/guide/nanobanana' },
          { text: '侧边栏自动收起', link: '/guide/sidebar-auto-hide' },
          { text: '防自动跳转', link: '/guide/prevent-auto-scroll' },
          { text: '输入框折叠', link: '/guide/input-collapse' },
          { text: '侧栏 Gems 列表', link: '/guide/gems-sidebar' },
          { text: '用量状态条', link: '/guide/usage-status' },
          { text: '默认模型', link: '/guide/default-model' },
          { text: '上下文同步到IDE（实验性）', link: '/guide/context-sync' },
          { text: '用户消息 LaTeX 渲染', link: '/guide/user-latex' },
          { text: '消息时间戳', link: '/guide/timestamp' },
          { text: '字体大小', link: '/guide/chat-font-size' },
        ],
      },
      {
        text: '插件',
        items: [
          { text: '插件一览', link: '/guide/plugins' },
          { text: 'ChatGPT 本地桥', link: '/guide/local-bridge' },
          { text: '编写自己的插件', link: '/guide/write-a-plugin' },
          { text: '插件贡献说明', link: '/guide/plugin-contribution' },
          { text: '新增平台', link: '/guide/adding-a-platform' },
          { text: 'DOM 操作边界', link: '/guide/dom-operation-boundaries' },
        ],
      },
      {
        text: '本地 Web UI',
        items: [{ text: 'DeepSeek Harness', link: '/guide/deepseek-harness' }],
      },
      {
        text: '更多',
        items: [
          { text: '交流与反馈', link: '/guide/community' },
          { text: '赞助', link: '/guide/sponsor' },
          { text: '受 Voyager 启发的项目', link: '/guide/ecosystem' },
          { text: '更新日志', link: '/changelog' },
        ],
      },
    ],
    footer: {
      message:
        '本项目开源。欢迎在 <a href="https://github.com/voyager-crew/voyager" target="_blank">GitHub</a> 上给一颗 ⭐ 支持。',
      copyright:
        '基于 GPLv3 协议发布 | Copyright © 2026 Jesse Zhang | <a href="/privacy">隐私政策</a> | <a href="/changelog">更新日志</a>',
    },
  },
};

export default locale;
