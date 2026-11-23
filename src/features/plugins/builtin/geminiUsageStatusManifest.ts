import type { PluginManifest } from '../types';

/**
 * Gemini's usage status bar, as a packaged builtin plugin. A builtin rather
 * than a catalog plugin because its runtime is first-party code (the
 * account-scoped usage cache, `/usage` scraping and a silent refresh through
 * the MAIN-world usage observer), bound to this id in
 * `pluginNativeRegistration.ts`. The plugin host turns it on and off from
 * `gvUsageStatusEnabled` and fills `display` (whether the bars count used or
 * remaining) from `gvUsageStatusDisplay`, so the popup row and the in-page
 * panel both offer the choice from this one declaration.
 *
 * Whether it or the native module runs the feature is decided per build by
 * `sites/featureOwners.ts`; while that entry is `legacy`, it is never admitted.
 */
export const GEMINI_USAGE_STATUS_MANIFEST: PluginManifest = {
  id: 'voyager.gemini-usage-status',
  name: 'Gemini · Usage Status',
  version: '1.0.0',
  description:
    "Show Gemini's 5-hour and weekly usage limits in a small bar near the chat box, per account.",
  i18n: {
    zh: {
      name: 'Gemini · 用量状态栏',
      description: '在聊天框附近用一条小栏按账号显示 Gemini 的 5 小时和每周用量限额。',
      settings: {
        display: { label: '进度条显示', options: { used: '已用', remaining: '剩余' } },
      },
    },
    zh_TW: {
      name: 'Gemini · 用量狀態列',
      description: '在聊天框附近以一條小欄依帳號顯示 Gemini 的 5 小時與每週用量上限。',
      settings: {
        display: { label: '進度條顯示', options: { used: '已用', remaining: '剩餘' } },
      },
    },
    ja: {
      name: 'Gemini · 利用状況バー',
      description:
        'Gemini の 5 時間と週間の利用上限を、アカウントごとにチャットボックス近くの小さなバーに表示します。',
      settings: {
        display: { label: 'バーの表示', options: { used: '使用量', remaining: '残量' } },
      },
    },
    ko: {
      name: 'Gemini · 사용량 상태 바',
      description:
        'Gemini의 5시간 및 주간 사용 한도를 계정별로 채팅창 근처의 작은 바에 표시합니다.',
      settings: {
        display: { label: '바 표시', options: { used: '사용량', remaining: '남은 양' } },
      },
    },
    fr: {
      name: "Gemini · Barre d'utilisation",
      description:
        "Affiche, compte par compte, les limites d'utilisation de Gemini sur 5 heures et sur la semaine dans une petite barre près de la zone de discussion.",
      settings: {
        display: { label: 'La barre affiche', options: { used: 'Utilisé', remaining: 'Restant' } },
      },
    },
    es: {
      name: 'Gemini · Barra de uso',
      description:
        'Muestra por cuenta los límites de uso de Gemini de 5 horas y semanal en una pequeña barra junto al cuadro de chat.',
      settings: {
        display: { label: 'La barra muestra', options: { used: 'Usado', remaining: 'Restante' } },
      },
    },
    pt: {
      name: 'Gemini · Barra de uso',
      description:
        'Mostra por conta os limites de uso do Gemini de 5 horas e semanal em uma pequena barra perto da caixa de chat.',
      settings: {
        display: { label: 'A barra mostra', options: { used: 'Usado', remaining: 'Restante' } },
      },
    },
    ru: {
      name: 'Gemini · Панель использования',
      description:
        'Показывает 5-часовой и недельный лимиты Gemini отдельно для каждого аккаунта на небольшой панели рядом с полем чата.',
      settings: {
        display: {
          label: 'Полоса показывает',
          options: { used: 'Использовано', remaining: 'Осталось' },
        },
      },
    },
    ar: {
      name: 'Gemini · شريط الاستخدام',
      description:
        'يعرض حدود استخدام Gemini لكل 5 ساعات وكل أسبوع لكل حساب على حدة، في شريط صغير بجوار مربع المحادثة.',
      settings: {
        display: { label: 'يعرض الشريط', options: { used: 'المستخدم', remaining: 'المتبقي' } },
      },
    },
  },
  author: 'voyager-official',
  category: 'productivity',
  license: 'GPL-3.0-or-later',
  engine: '>=1.2.0',
  tier: 'declarative',
  matches: ['https://gemini.google.com/*'],
  contributes: {
    settings: {
      display: {
        type: 'select',
        label: 'Bar shows',
        default: 'used',
        options: [
          { value: 'used', label: 'Used' },
          { value: 'remaining', label: 'Remaining' },
        ],
      },
    },
  },
};
