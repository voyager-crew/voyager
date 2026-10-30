import type { PluginManifest } from '../types';
import { contract as conversationExportContract } from '../verbs/conversationExport/contract';

/** Fixed-id export entry points; their default-on sync switch is bound outside plugin state. */
export const GEMINI_EXPORT_MANIFEST: PluginManifest = {
  id: 'voyager.gemini-export',
  name: 'Gemini · Conversation export',
  version: '1.0.0',
  description:
    'Export a conversation as JSON, Markdown, PDF or an image from its menus or the Export button, and copy a single reply as an image.',
  i18n: {
    zh: {
      name: 'Gemini · 对话导出',
      description:
        '从对话菜单或“导出”按钮将对话导出为 JSON、Markdown、PDF 或图片，也可以把单条回复复制为图片。',
    },
    zh_TW: {
      name: 'Gemini · 對話匯出',
      description:
        '從對話選單或「匯出」按鈕將對話匯出為 JSON、Markdown、PDF 或圖片，也能把單則回覆複製為圖片。',
    },
    ja: {
      name: 'Gemini · 会話のエクスポート',
      description:
        '会話のメニューや「エクスポート」ボタンから、会話を JSON・Markdown・PDF・画像として書き出し、1 件の回答を画像としてコピーできます。',
    },
    ko: {
      name: 'Gemini · 대화 내보내기',
      description:
        "대화 메뉴나 '내보내기' 버튼에서 대화를 JSON, Markdown, PDF 또는 이미지로 내보내고, 응답 하나를 이미지로 복사합니다.",
    },
    fr: {
      name: 'Gemini · Export de conversation',
      description:
        'Exportez une conversation en JSON, Markdown, PDF ou image depuis ses menus ou le bouton « Exporter », et copiez une réponse sous forme d’image.',
    },
    es: {
      name: 'Gemini · Exportar conversación',
      description:
        'Exporta una conversación como JSON, Markdown, PDF o imagen desde sus menús o el botón «Exportar», y copia una respuesta como imagen.',
    },
    pt: {
      name: 'Gemini · Exportar conversa',
      description:
        'Exporte uma conversa como JSON, Markdown, PDF ou imagem pelos menus ou pelo botão “Exportar” e copie uma resposta como imagem.',
    },
    ru: {
      name: 'Gemini · Экспорт диалога',
      description:
        'Экспортирует диалог в JSON, Markdown, PDF или изображение из его меню или кнопкой «Экспорт» и копирует отдельный ответ как изображение.',
    },
    ar: {
      name: 'Gemini · تصدير المحادثة',
      description:
        'يصدّر المحادثة بصيغة JSON أو Markdown أو PDF أو صورة من قوائمها أو من زر «تصدير»، وينسخ ردًا واحدًا كصورة.',
    },
  },
  author: 'voyager-official',
  category: 'productivity',
  license: 'GPL-3.0-or-later',
  engine: `>=${conversationExportContract.sinceEngine}`,
  tier: 'declarative',
  matches: ['https://gemini.google.com/*'],
  requires: { formFactors: ['desktop', 'mobile'] },
  contributes: { domOps: [{ op: 'native', handler: 'conversationExport', params: {} }] },
};
