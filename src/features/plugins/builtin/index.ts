import { type PluginManifest, hasNativeOps } from '../types';
import { timelineManifest } from './timelineManifest';

/** ChatGPT stamps the owning conversation id on each rendered reply. */
export const CHATGPT_CONVERSATION_ID_ATTRIBUTE = 'data-chatgpt-selection-conversation-id';

/**
 * Built-in (bundled-in-the-extension) plugins — first-party data, NOT from the
 * remote marketplace.
 *
 * Two kinds live here. A manifest with a `native` op invokes a first-party
 * primitive by name (formula copy, Vim input, the timeline; see verbs/) and
 * needs nothing else. A "native function plugin" (export, temporary-chat
 * handoff) declares no contributions and the content script binds its
 * behaviour with `registerNativeHandler(<same id>, { start, stop })` (see
 * runtime/nativeHandlers). Either way the engine runs the code in lockstep
 * with the plugin's mount/unmount, so the feature is visible + toggleable in
 * the plugin list and scoped by `matches`, while the code stays first-party.
 * Builtin ids are never overridden by the remote catalog (plan D20).
 *
 * Like every plugin, builtin plugins ship DISABLED by default — the user turns
 * them on in the popup.
 */
export const BUILTIN_PLUGINS: readonly PluginManifest[] = [
  {
    id: 'voyager.formula-copy',
    name: 'Formula Copy',
    version: '1.0.0',
    description: "Click an inline or block formula to copy its LaTeX; hover shows it's clickable.",
    i18n: {
      zh: {
        name: '公式复制',
        description: '点击行内或块级公式即可复制 LaTeX；悬停时会提示可点击。',
      },
      zh_TW: {
        name: '公式複製',
        description: '點擊行內或區塊公式即可複製 LaTeX；滑鼠懸停時會提示可點擊。',
      },
      ja: {
        name: '数式コピー',
        description:
          'インラインまたはブロック数式をクリックして LaTeX をコピーできます。ホバーするとクリック可能であることが分かります。',
      },
      ko: {
        name: '수식 복사',
        description:
          '인라인 또는 블록 수식을 클릭해 LaTeX를 복사합니다. 마우스를 올리면 클릭 가능함을 표시합니다.',
      },
      fr: {
        name: 'Copie de formules',
        description:
          "Cliquez sur une formule en ligne ou en bloc pour copier son LaTeX ; le survol indique qu'elle est cliquable.",
      },
      es: {
        name: 'Copia de fórmulas',
        description:
          'Haz clic en una fórmula en línea o en bloque para copiar su LaTeX; al pasar el cursor se muestra que se puede hacer clic.',
      },
      pt: {
        name: 'Cópia de fórmulas',
        description:
          'Clique em uma fórmula inline ou em bloco para copiar o LaTeX; ao passar o cursor, ela indica que pode ser clicada.',
      },
      ru: {
        name: 'Копирование формул',
        description:
          'Нажмите на строчную или блочную формулу, чтобы скопировать её LaTeX; при наведении видно, что её можно нажать.',
      },
      ar: {
        name: 'نسخ الصيغ',
        description:
          'انقر على صيغة مضمنة أو كتلية لنسخ LaTeX الخاص بها؛ ويظهر عند التحويم أنها قابلة للنقر.',
      },
    },
    author: 'voyager-official',
    category: 'productivity',
    license: 'GPL-3.0-or-later',
    engine: '>=1.4.0',
    tier: 'declarative',
    matches: ['https://claude.ai/*', 'https://chatgpt.com/*', 'https://chat.openai.com/*'],
    requires: { handlers: ['formulaCopy'] },
    contributes: { domOps: [{ op: 'native', handler: 'formulaCopy', params: {} }] },
  },
  {
    id: 'voyager.input-vim',
    name: 'Vim Input',
    version: '1.0.0',
    description: 'Adds Vim-style modal editing and navigation to the prompt composer.',
    i18n: {
      zh: {
        name: 'Vim 输入',
        description: '为提示词输入框添加 Vim 风格的模式编辑与光标导航。',
      },
      zh_TW: {
        name: 'Vim 輸入',
        description: '為提示詞輸入框加入 Vim 風格的模式編輯與游標導覽。',
      },
      ja: {
        name: 'Vim 入力',
        description: 'プロンプト入力欄に Vim 風のモーダル編集とカーソル移動を追加します。',
      },
      ko: {
        name: 'Vim 입력',
        description: '프롬프트 입력창에 Vim 스타일 모달 편집과 커서 이동을 추가합니다.',
      },
      fr: {
        name: 'Saisie Vim',
        description:
          "Ajoute l'édition modale et la navigation du curseur de style Vim au champ de saisie.",
      },
      es: {
        name: 'Entrada Vim',
        description:
          'Añade edición modal y navegación del cursor al estilo Vim al cuadro de entrada.',
      },
      pt: {
        name: 'Entrada Vim',
        description:
          'Adiciona edição modal e navegação de cursor no estilo Vim ao campo de entrada.',
      },
      ru: {
        name: 'Vim-ввод',
        description: 'Добавляет в поле ввода модальное редактирование и навигацию в стиле Vim.',
      },
      ar: {
        name: 'إدخال Vim',
        description: 'يضيف التحرير النمطي والتنقل بالمؤشر بأسلوب Vim إلى حقل الإدخال.',
      },
    },
    author: 'voyager-official',
    category: 'productivity',
    license: 'GPL-3.0-or-later',
    engine: '>=1.4.0',
    tier: 'declarative',
    matches: ['https://claude.ai/*', 'https://chatgpt.com/*', 'https://chat.openai.com/*'],
    requires: { handlers: ['vimInput'], semantic: ['composer'] },
    contributes: { domOps: [{ op: 'native', handler: 'vimInput', params: {} }] },
  },
  timelineManifest({
    id: 'voyager.claude-timeline',
    siteLabel: 'Claude',
    version: '1.2.0',
    matches: ['https://claude.ai/*'],
    params: {
      // Never open the onboarding guide over an active artifact frame.
      yieldWhen: 'iframe[src*="claudeusercontent.com"]',
      // Claude's thread container names its conversation and changes it
      // in the render that swaps the turns: it decides star writes.
      conversationIdAttribute: 'data-conv-id',
    },
  }),
  timelineManifest({
    id: 'voyager.chatgpt-timeline',
    siteLabel: 'ChatGPT',
    version: '1.1.0',
    matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    // Selectors and the URL's conversation id come from the ChatGPT
    // adapter, so fixes travel with site.json. ChatGPT unmounts whole
    // exchange items off-screen, so the rail accumulates them. A star is
    // written only for a turn whose reply, inside its item, names the
    // conversation the URL is on.
    params: {
      turnItem: '[data-turn-key]',
      conversationIdAttribute: CHATGPT_CONVERSATION_ID_ATTRIBUTE,
      accountIdAttributes: ['data-theme-user-id', 'data-theme-account-id'],
    },
  }),
  {
    id: 'voyager.chatgpt-export',
    name: 'ChatGPT · Conversation Export',
    version: '1.0.0',
    description: 'Export the current ChatGPT conversation as Markdown, JSON, PDF, or an image.',
    i18n: {
      zh: {
        name: 'ChatGPT · 对话导出',
        description: '将当前 ChatGPT 对话导出为 Markdown、JSON、PDF 或图片。',
      },
      zh_TW: {
        name: 'ChatGPT · 對話匯出',
        description: '將目前 ChatGPT 對話匯出為 Markdown、JSON、PDF 或圖片。',
      },
      ja: {
        name: 'ChatGPT · 会話エクスポート',
        description:
          '現在の ChatGPT 会話を Markdown、JSON、PDF、または画像としてエクスポートします。',
      },
      ko: {
        name: 'ChatGPT · 대화 내보내기',
        description: '현재 ChatGPT 대화를 Markdown, JSON, PDF 또는 이미지로 내보냅니다.',
      },
      fr: {
        name: 'ChatGPT · Export de conversation',
        description:
          'Exporte la conversation ChatGPT actuelle au format Markdown, JSON, PDF ou image.',
      },
      es: {
        name: 'ChatGPT · Exportar conversación',
        description: 'Exporta la conversación actual de ChatGPT como Markdown, JSON, PDF o imagen.',
      },
      pt: {
        name: 'ChatGPT · Exportar conversa',
        description: 'Exporte a conversa atual do ChatGPT como Markdown, JSON, PDF ou imagem.',
      },
      ru: {
        name: 'ChatGPT · Экспорт диалога',
        description: 'Экспортирует текущий диалог ChatGPT в Markdown, JSON, PDF или изображение.',
      },
      ar: {
        name: 'ChatGPT · تصدير المحادثة',
        description: 'يصدّر محادثة ChatGPT الحالية بصيغة Markdown أو JSON أو PDF أو صورة.',
      },
    },
    author: 'voyager-official',
    category: 'productivity',
    license: 'GPL-3.0-or-later',
    engine: '>=1.2.0',
    tier: 'declarative',
    matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    contributes: {},
  },
  {
    id: 'voyager.chatgpt-temporary-handoff',
    name: 'ChatGPT · Temporary Chat Handoff',
    version: '1.0.0',
    description: 'Save a temporary ChatGPT conversation and continue it safely in a normal chat.',
    i18n: {
      zh: {
        name: 'ChatGPT · 临时对话反悔',
        description: '保存临时 ChatGPT 对话，并安全地转到普通聊天继续。',
      },
      zh_TW: {
        name: 'ChatGPT · 暫時對話反悔',
        description: '儲存暫時 ChatGPT 對話，並安全地轉到一般聊天繼續。',
      },
      ja: {
        name: 'ChatGPT · 一時チャット引き継ぎ',
        description: '一時チャットを保存し、通常のチャットへ安全に引き継ぎます。',
      },
      ko: {
        name: 'ChatGPT · 임시 채팅 이어가기',
        description: '임시 ChatGPT 대화를 저장하고 일반 채팅에서 안전하게 이어갑니다.',
      },
      fr: {
        name: 'ChatGPT · Transfert du chat temporaire',
        description:
          'Enregistre une discussion temporaire et la poursuit en toute sécurité dans un chat normal.',
      },
      es: {
        name: 'ChatGPT · Transferir chat temporal',
        description:
          'Guarda una conversación temporal y la continúa de forma segura en un chat normal.',
      },
      pt: {
        name: 'ChatGPT · Transferir chat temporário',
        description: 'Salva uma conversa temporária e continua com segurança em um chat normal.',
      },
      ru: {
        name: 'ChatGPT · Перенос временного чата',
        description: 'Сохраняет временный диалог и безопасно продолжает его в обычном чате.',
      },
      ar: {
        name: 'ChatGPT · نقل المحادثة المؤقتة',
        description: 'يحفظ محادثة مؤقتة ويتابعها بأمان في دردشة عادية.',
      },
    },
    author: 'voyager-official',
    category: 'productivity',
    license: 'GPL-3.0-or-later',
    engine: '>=1.2.0',
    tier: 'declarative',
    matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    contributes: {},
  },
  {
    id: 'voyager.chatgpt-folders',
    name: 'ChatGPT · Folders',
    version: '1.0.0',
    description:
      'Organize ChatGPT conversations into folders in the sidebar or a floating panel, with import and export.',
    i18n: {
      zh: {
        name: 'ChatGPT · 文件夹',
        description: '在侧边栏或浮动面板中用文件夹整理 ChatGPT 对话，支持导入和导出。',
        settings: { hideFiledChats: { label: '在侧边栏的聊天列表中隐藏已放入文件夹的对话' } },
      },
      zh_TW: {
        name: 'ChatGPT · 資料夾',
        description: '在側邊欄或浮動面板中用資料夾整理 ChatGPT 對話，支援匯入與匯出。',
        settings: { hideFiledChats: { label: '在側邊欄的聊天列表中隱藏已放入資料夾的對話' } },
      },
      ja: {
        name: 'ChatGPT · フォルダ',
        description:
          'サイドバーやフローティングパネルで ChatGPT の会話をフォルダに整理できます。インポートとエクスポートにも対応。',
        settings: {
          hideFiledChats: {
            label: 'フォルダに入れたチャットをサイドバーのチャット一覧に表示しない',
          },
        },
      },
      ko: {
        name: 'ChatGPT · 폴더',
        description:
          '사이드바나 플로팅 패널에서 ChatGPT 대화를 폴더로 정리합니다. 가져오기와 내보내기를 지원합니다.',
        settings: { hideFiledChats: { label: '폴더에 넣은 채팅을 사이드바 채팅 목록에서 숨기기' } },
      },
      fr: {
        name: 'ChatGPT · Dossiers',
        description:
          'Classez vos conversations ChatGPT dans des dossiers depuis la barre latérale ou un panneau flottant, avec import et export.',
        settings: {
          hideFiledChats: {
            label: 'Masquer les chats classés dans un dossier de la liste latérale',
          },
        },
      },
      es: {
        name: 'ChatGPT · Carpetas',
        description:
          'Organiza las conversaciones de ChatGPT en carpetas desde la barra lateral o un panel flotante, con importación y exportación.',
        settings: {
          hideFiledChats: {
            label: 'Ocultar de la lista lateral los chats que ya están en carpetas',
          },
        },
      },
      pt: {
        name: 'ChatGPT · Pastas',
        description:
          'Organize as conversas do ChatGPT em pastas na barra lateral ou num painel flutuante, com importação e exportação.',
        settings: {
          hideFiledChats: { label: 'Ocultar da lista lateral as conversas que já estão em pastas' },
        },
      },
      ru: {
        name: 'ChatGPT · Папки',
        description:
          'Раскладывайте диалоги ChatGPT по папкам в боковой панели или в плавающей панели, с импортом и экспортом.',
        settings: {
          hideFiledChats: {
            label: 'Скрывать из списка в боковой панели чаты, уже разложенные по папкам',
          },
        },
      },
      ar: {
        name: 'ChatGPT · المجلدات',
        description:
          'نظّم محادثات ChatGPT في مجلدات من الشريط الجانبي أو لوحة عائمة، مع الاستيراد والتصدير.',
        settings: {
          hideFiledChats: { label: 'إخفاء المحادثات الموجودة في مجلدات من قائمة الشريط الجانبي' },
        },
      },
    },
    author: 'voyager-official',
    category: 'productivity',
    license: 'GPL-3.0-or-later',
    engine: '>=1.2.0',
    tier: 'declarative',
    matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    contributes: {
      settings: {
        hideFiledChats: {
          type: 'boolean',
          label: 'Hide chats already in folders from the sidebar list',
          default: false,
        },
      },
    },
  },
];

/**
 * Builtin plugins come in two shapes. Those whose behaviour is a primitive
 * (`native` op: formula copy, Vim input, the timeline) need no binding — the
 * engine resolves the primitive by name. The rest (export, temporary-chat
 * handoff) still run first-party code bound to their plugin id and MUST have a
 * `registerNativeHandler(<id>, …)` call in the content script (and vice
 * versa). `verifyNativeHandlerBindings(NATIVE_BUILTIN_PLUGIN_IDS)` enforces
 * both directions after registration — adding a plugin to one side without
 * the other surfaces as a logged error instead of a dead toggle.
 */
export const NATIVE_BUILTIN_PLUGIN_IDS: readonly string[] = BUILTIN_PLUGINS.filter(
  (plugin) => !hasNativeOps(plugin),
).map((p) => p.id);
