import type { PluginManifest } from '../types';
import { MARKER_LEVEL_SETTING } from './timelineManifest';

/**
 * The fixed-id Gemini rail follows its native data policy; no catalog
 * turnNavigator. Its options are these settings, each bound to the rail's
 * existing `geminiTimeline*` sync key (`legacyValueBindings.ts`), so the popup
 * row and the in-page panel offer them from this one declaration and the rail
 * takes a change through `updateSettings`. Booleans reuse the extension's own
 * wording; the position reset and the Saved Library stay the row's actions.
 */
export const GEMINI_TIMELINE_MANIFEST: PluginManifest = {
  id: 'voyager.gemini-timeline',
  name: 'Gemini · Show Timeline',
  description: 'Turning this off keeps saved items. Message timestamps follow their own setting.',
  version: '1.0.0',
  i18n: {
    zh: {
      name: 'Gemini · 显示时间线',
      description: '关闭后保留收藏内容，消息时间仍由「消息时间戳」单独控制。',
      settings: {
        timelineStyle: {
          label: '时间线样式',
          options: { dots: '节点', ruler: '刻度', compact: '紧凑索引' },
        },
        scrollMode: { label: '滚动模式', options: { flow: '流动', jump: '跳跃' } },
      },
    },
    zh_TW: {
      name: 'Gemini · 顯示時間軸',
      description: '關閉後保留收藏內容，訊息時間仍由「訊息時間戳記」單獨控制。',
      settings: {
        timelineStyle: {
          label: '時間軸樣式',
          options: { dots: '節點', ruler: '刻度', compact: '精簡索引' },
        },
        scrollMode: { label: '捲動模式', options: { flow: '流動', jump: '跳躍' } },
      },
    },
    ja: {
      name: 'Gemini · タイムラインを表示',
      description:
        'オフにしても保存済みの項目は保持されます。メッセージの時刻は専用の設定で表示・非表示を切り替えます。',
      settings: {
        timelineStyle: {
          label: 'タイムライン表示',
          options: { dots: 'ノード', ruler: '目盛り', compact: 'コンパクト' },
        },
        scrollMode: { label: 'スクロールモード', options: { flow: 'フロー', jump: 'ジャンプ' } },
      },
    },
    ko: {
      name: 'Gemini · 타임라인 표시',
      description:
        '꺼도 저장된 항목은 유지됩니다. 메시지 시간은 별도 설정으로 표시 여부를 제어합니다.',
      settings: {
        timelineStyle: {
          label: '타임라인 스타일',
          options: { dots: '노드', ruler: '눈금', compact: '컴팩트' },
        },
        scrollMode: { label: '스크롤 모드', options: { flow: '플로우', jump: '점프' } },
      },
    },
    fr: {
      name: 'Gemini · Afficher la chronologie',
      description:
        'Désactiver cette option conserve les éléments enregistrés. Les horodatages des messages suivent leur propre réglage.',
      settings: {
        timelineStyle: {
          label: 'Style de la chronologie',
          options: { dots: 'Nœuds', ruler: 'Graduations', compact: 'Compact' },
        },
        scrollMode: { label: 'Mode défilement', options: { flow: 'Flux', jump: 'Saut' } },
      },
    },
    es: {
      name: 'Gemini · Mostrar línea de tiempo',
      description:
        'Al desactivarla se conservan los elementos guardados. Las marcas de tiempo de los mensajes dependen de su propio ajuste.',
      settings: {
        timelineStyle: {
          label: 'Estilo de cronología',
          options: { dots: 'Nodos', ruler: 'Escala', compact: 'Compacto' },
        },
        scrollMode: { label: 'Modo desplazamiento', options: { flow: 'Flujo', jump: 'Salto' } },
      },
    },
    pt: {
      name: 'Gemini · Mostrar linha do tempo',
      description:
        'Ao desativar, os itens salvos são mantidos. Os horários das mensagens seguem sua própria configuração.',
      settings: {
        timelineStyle: {
          label: 'Estilo da linha do tempo',
          options: { dots: 'Nós', ruler: 'Régua', compact: 'Compacto' },
        },
        scrollMode: { label: 'Modo de rolagem', options: { flow: 'Fluxo', jump: 'Pulo' } },
      },
    },
    ru: {
      name: 'Gemini · Показывать таймлайн',
      description:
        'При отключении сохранённые элементы остаются. Временные метки сообщений управляются отдельной настройкой.',
      settings: {
        timelineStyle: {
          label: 'Стиль временной шкалы',
          options: { dots: 'Узлы', ruler: 'Шкала', compact: 'Компактный' },
        },
        scrollMode: { label: 'Режим прокрутки', options: { flow: 'Поток', jump: 'Прыжок' } },
      },
    },
    ar: {
      name: 'Gemini · إظهار الجدول الزمني',
      description:
        'عند إيقافه، تبقى العناصر المحفوظة. تتحكم إعدادات مستقلة في عرض طوابع وقت الرسائل.',
      settings: {
        timelineStyle: {
          label: 'نمط الخط الزمني',
          options: { dots: 'العُقد', ruler: 'تدريج', compact: 'مضغوط' },
        },
        scrollMode: { label: 'وضع التمرير', options: { flow: 'تدفق', jump: 'قفز' } },
      },
    },
  },
  author: 'voyager-official',
  category: 'productivity',
  license: 'GPL-3.0-or-later',
  engine: '>=1.2.0',
  tier: 'declarative',
  matches: ['https://gemini.google.com/*'],
  requires: { formFactors: ['desktop', 'mobile'] },
  contributes: {
    settings: {
      timelineStyle: {
        type: 'select',
        label: 'Timeline style',
        default: 'dots',
        options: [
          { value: 'dots', label: 'Nodes' },
          { value: 'ruler', label: 'Ruler' },
          { value: 'compact', label: 'Compact' },
        ],
      },
      scrollMode: {
        type: 'select',
        label: 'Scroll mode',
        default: 'flow',
        options: [
          { value: 'flow', label: 'Flow' },
          { value: 'jump', label: 'Jump' },
        ],
      },
      hideContainer: {
        type: 'boolean',
        label: 'Hide outer container',
        default: false,
        // Ruler and compact paint no rail, so the stored value waits for the dots style.
        messageKeys: { label: 'hideOuterContainer', hint: 'hideOuterContainerDotsOnly' },
      },
      draggable: {
        type: 'boolean',
        label: 'Draggable Timeline',
        default: false,
        messageKeys: { label: 'draggableTimeline' },
      },
      previewPinned: {
        type: 'boolean',
        label: 'Pin preview panel',
        default: false,
        messageKeys: { label: 'pinTimelinePreview', hint: 'pinTimelinePreviewHint' },
      },
      markerLevel: MARKER_LEVEL_SETTING,
    },
  },
};
