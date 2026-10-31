import type { DefaultTheme, LocaleSpecificConfig } from 'vitepress';

import { announcementNav } from '../announcementNav';

const locale: LocaleSpecificConfig<DefaultTheme.Config> & { label: string; link?: string } = {
  label: 'Русский',
  lang: 'ru-RU',
  link: '/ru/',
  themeConfig: {
    nav: [
      ...announcementNav('Объявление'),
      { text: 'Главная', link: '/ru/' },
      { text: 'Руководство', link: '/ru/guide/installation' },
      { text: 'Просмотр', link: '/ru/data-viewer' },
    ],
    sidebar: [
      {
        text: 'Введение',
        items: [
          { text: 'Установка', link: '/ru/guide/installation' },
          { text: 'Начало работы', link: '/ru/guide/getting-started' },
          { text: 'Панель Voyager', link: '/ru/guide/panel' },
        ],
      },
      {
        text: 'Основные функции',
        items: [
          { text: 'Папки', link: '/ru/guide/folders' },
          { text: 'Режим Activity', link: '/ru/guide/activity-view' },
          { text: 'Библиотека промптов', link: '/ru/guide/prompts' },
          { text: 'Облачная синхронизация', link: '/ru/guide/cloud-sync' },
          { text: 'Навигация по таймлайну', link: '/ru/guide/timeline' },
          { text: 'Экспорт чата', link: '/ru/guide/export' },
          { text: 'Ответ с цитированием', link: '/ru/guide/quote-reply' },
          { text: 'Копирование Canvas в Markdown', link: '/ru/guide/canvas-copy' },
          { text: 'Поведение отправки', link: '/ru/guide/send-behavior' },
          { text: 'Копирование формул', link: '/ru/guide/formula-copy' },
          { text: 'Ширина боковой панели', link: '/ru/guide/sidebar' },
        ],
      },
      {
        text: 'Gemini & AI Studio',
        items: [
          {
            text: 'Ветвление разговора (Экспериментально)',
            link: '/ru/guide/fork',
          },
          { text: 'Сделайте его своим', link: '/ru/guide/settings' },
          { text: 'Пакетное удаление', link: '/ru/guide/batch-delete' },
          { text: 'Экспорт Deep Research', link: '/ru/guide/deep-research' },
          { text: 'Mermaid диаграммы', link: '/ru/guide/mermaid' },
          { text: 'Исправление рендеринга Markdown', link: '/ru/guide/markdown-fix' },
          { text: 'NanoBanana', link: '/ru/guide/nanobanana' },
          { text: 'Авто-скрытие боковой панели', link: '/ru/guide/sidebar-auto-hide' },
          { text: 'Предотвращение автопрокрутки', link: '/ru/guide/prevent-auto-scroll' },
          { text: 'Сворачивание ввода', link: '/ru/guide/input-collapse' },
          {
            text: 'Недавние Gems на боковой панели',
            link: '/ru/guide/gems-sidebar',
          },
          { text: 'Панель статуса использования', link: '/ru/guide/usage-status' },
          { text: 'Модель по умолчанию', link: '/ru/guide/default-model' },
          {
            text: 'Синхронизация контекста (Экспериментально)',
            link: '/ru/guide/context-sync',
          },
          { text: 'Рендеринг LaTeX в сообщениях', link: '/ru/guide/user-latex' },
          { text: 'Временные метки сообщений', link: '/ru/guide/timestamp' },
          { text: 'Размер шрифта', link: '/ru/guide/chat-font-size' },
        ],
      },
      {
        text: 'Плагины',
        items: [
          { text: 'Все плагины', link: '/ru/guide/plugins' },
          { text: 'Локальный мост ChatGPT', link: '/ru/guide/local-bridge' },
          { text: 'Создание своего плагина', link: '/ru/guide/write-a-plugin' },
          { text: 'Участие в плагинах', link: '/ru/guide/plugin-contribution' },
          { text: 'Добавление новой платформы', link: '/ru/guide/adding-a-platform' },
          { text: 'Границы DOM-операций', link: '/ru/guide/dom-operation-boundaries' },
        ],
      },
      {
        text: 'Локальный веб-интерфейс',
        items: [{ text: 'DeepSeek Harness', link: '/ru/guide/deepseek-harness' }],
      },
      {
        text: 'Ещё',
        items: [
          { text: 'Сообщество', link: '/ru/guide/community' },
          { text: 'Поддержать', link: '/ru/guide/sponsor' },
          { text: 'Экосистема', link: '/ru/guide/ecosystem' },
          { text: 'Изменения', link: '/ru/changelog' },
        ],
      },
    ],
    footer: {
      message:
        'Проект с открытым исходным кодом. Поставьте ⭐ на <a href="https://github.com/voyager-crew/voyager" target="_blank">GitHub</a>, если вам нравится.',
      copyright:
        'Лицензия GPLv3 | Copyright © 2026 Jesse Zhang | <a href="/ru/privacy">Политика конфиденциальности</a> | <a href="/ru/changelog">Изменения</a>',
    },
  },
};

export default locale;
