import type { PluginManifest } from '../types';

/** Fixed-id Canvas copy runtime; its default-on sync switch is bound outside plugin state. */
export const GEMINI_CANVAS_COPY_MANIFEST: PluginManifest = {
  id: 'voyager.gemini-canvas-copy',
  name: 'Gemini · Canvas copy as Markdown',
  version: '1.0.0',
  description: 'Copy a Canvas document as Markdown from the Export menu.',
  i18n: {
    zh: {
      name: 'Gemini · Canvas 复制为 Markdown',
      description: '在 Canvas 的导出菜单中，将文档复制为 Markdown。',
    },
    zh_TW: {
      name: 'Gemini · Canvas 複製為 Markdown',
      description: '在 Canvas 的匯出選單中，將文件複製為 Markdown。',
    },
    ja: {
      name: 'Gemini · Canvas を Markdown としてコピー',
      description:
        'Canvas のエクスポートメニューから、ドキュメントを Markdown としてコピーします。',
    },
    ko: {
      name: 'Gemini · Canvas를 Markdown으로 복사',
      description: 'Canvas 내보내기 메뉴에서 문서를 Markdown으로 복사합니다.',
    },
    fr: {
      name: 'Gemini · Copier Canvas en Markdown',
      description: 'Copiez un document Canvas au format Markdown depuis le menu Exporter.',
    },
    es: {
      name: 'Gemini · Copiar Canvas como Markdown',
      description: 'Copia un documento de Canvas como Markdown desde el menú Exportar.',
    },
    pt: {
      name: 'Gemini · Copiar Canvas como Markdown',
      description: 'Copie um documento do Canvas como Markdown pelo menu Exportar.',
    },
    ru: {
      name: 'Gemini · Копирование Canvas в Markdown',
      description: 'Копируйте документ Canvas в формате Markdown через меню «Экспорт».',
    },
    ar: {
      name: 'Gemini · نسخ Canvas بصيغة Markdown',
      description: 'انسخ مستند Canvas بصيغة Markdown من قائمة التصدير.',
    },
  },
  author: 'voyager-official',
  category: 'productivity',
  license: 'GPL-3.0-or-later',
  engine: '>=1.2.0',
  tier: 'declarative',
  matches: ['https://gemini.google.com/*'],
  contributes: {},
};
