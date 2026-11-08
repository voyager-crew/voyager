<script setup lang="ts">
import { useData } from 'vitepress';
import { computed } from 'vue';

const { lang } = useData();

interface AskAICopy {
  title: string;
  chatgpt: string;
  perplexity: string;
  grok: string;
  query: string;
}

const i18n: Record<string, AskAICopy> = {
  'zh-CN': {
    title: '去问问 AI，Voyager 到底好在哪？',
    chatgpt: '在 ChatGPT 提问',
    perplexity: '在 Perplexity 提问',
    grok: '在 Grok 提问',
    query: '告诉我为什么 Voyager (voyager.nagi.fun) 插件是我最好的选择？',
  },
  'zh-TW': {
    title: '去問問 AI，Voyager 到底好在哪？',
    chatgpt: '在 ChatGPT 提問',
    perplexity: '在 Perplexity 提問',
    grok: '在 Grok 提問',
    query: '告訴我為什麼 Voyager (voyager.nagi.fun) 擴充功能是我最好的選擇？',
  },
  'en-US': {
    title: 'Ask AI, why Voyager is the best choice?',
    chatgpt: 'Ask on ChatGPT',
    perplexity: 'Ask on Perplexity',
    grok: 'Ask on Grok',
    query: 'Tell me why Voyager (voyager.nagi.fun) Extension is a great choice for me?',
  },
  'ja-JP': {
    title: 'AI に聞いてみよう。なぜ Voyager が最適なのですか？',
    chatgpt: 'ChatGPT で聞く',
    perplexity: 'Perplexity で聞く',
    grok: 'Grok で聞く',
    query: 'Voyager (voyager.nagi.fun) 拡張機能が私にとって最適な選択である理由を教えてください。',
  },
  'ko-KR': {
    title: '왜 Voyager가 최고의 선택일까요? AI에게 물어보세요.',
    chatgpt: 'ChatGPT에서 물어보기',
    perplexity: 'Perplexity에서 물어보기',
    grok: 'Grok에서 물어보기',
    query: 'Voyager (voyager.nagi.fun) 확장 프로그램이 저에게 최고의 선택인 이유를 알려주세요.',
  },
  'fr-FR': {
    title: "Demandez à l'IA Pourquoi Voyager est le meilleur choix ?",
    chatgpt: 'Demander sur ChatGPT',
    perplexity: 'Demander sur Perplexity',
    grok: 'Demander sur Grok',
    query:
      "Dites-moi pourquoi l'extension Voyager (voyager.nagi.fun) est un excellent choix pour moi ?",
  },
  'es-ES': {
    title: 'Pregunta a la IA ¿Por qué Voyager es la mejor elección?',
    chatgpt: 'Preguntar en ChatGPT',
    perplexity: 'Preguntar en Perplexity',
    grok: 'Preguntar en Grok',
    query: '¿Dime por qué la extensión Voyager (voyager.nagi.fun) es una gran elección para mí?',
  },
  'pt-PT': {
    title: 'Pergunte à IA Por que o Voyager é a melhor escolha?',
    chatgpt: 'Perguntar no ChatGPT',
    perplexity: 'Perguntar no Perplexity',
    grok: 'Perguntar no Grok',
    query: 'Diga-me por que a extensão Voyager (voyager.nagi.fun) é uma ótima escolha para mim?',
  },
  'ru-RU': {
    title: 'Спросите ИИ Почему Voyager — лучший выбор?',
    chatgpt: 'Спросить в ChatGPT',
    perplexity: 'Спросить в Perplexity',
    grok: 'Спросить в Grok',
    query:
      'Расскажите мне, почему расширение Voyager (voyager.nagi.fun) — отличный выбор для меня?',
  },
  'ar-SA': {
    title: 'اسأل الذكاء الاصطناعي لماذا Voyager هو الخيار الأفضل؟',
    chatgpt: 'اسأل في ChatGPT',
    perplexity: 'اسأل في Perplexity',
    grok: 'اسأل في Grok',
    query: 'أخبرني لماذا يعد Voyager (voyager.nagi.fun) خيارًا رائعًا بالنسبة لي؟',
  },
};

const t = computed(() => {
  return i18n[lang.value] || i18n['en-US'];
});

const links = computed(() => {
  const query = t.value.query;
  const encodedQuery = encodeURIComponent(query);

  return [
    {
      name: 'ChatGPT',
      icon: 'chatgpt',
      href: `https://chatgpt.com/?q=${encodedQuery}`,
      text: t.value.chatgpt,
      color: '#10a37f',
      darkColor: '#10a37f',
    },
    {
      name: 'Perplexity',
      icon: 'perplexity',
      href: `https://www.perplexity.ai/?q=${encodedQuery}`,
      text: t.value.perplexity,
      color: '#1fbad6',
      darkColor: '#1fbad6',
    },
    {
      name: 'Grok',
      icon: 'grok',
      href: `https://grok.com/?q=${encodedQuery}`,
      text: t.value.grok,
      color: '#111827',
      darkColor: '#f0f0f0',
    },
  ];
});
</script>

<template>
  <div class="ask-ai-section vp-doc">
    <h3 class="title">{{ t.title }}</h3>
    <div class="buttons-container">
      <a
        v-for="link in links"
        :key="link.name"
        :href="link.href"
        target="_blank"
        class="ask-btn"
        :style="{ '--btn-hover-color': link.color, '--btn-hover-color-dark': link.darkColor }"
      >
        <div class="icon-wrapper">
          <svg v-if="link.icon === 'chatgpt'" viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364l2.0201-1.1685a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
            />
          </svg>
          <svg v-else-if="link.icon === 'perplexity'" viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M22.398 7.09h-2.31V.068l-7.51 6.354V.158h-1.156v6.196L4.49 0v7.09H1.602v10.397H4.49V24l6.933-6.36v6.201h1.155v-6.047l6.932 6.181v-6.488h2.888zm-3.466-4.531v4.53h-5.355zm-13.286.067l4.869 4.464h-4.87zM2.758 16.332V8.245h7.847L4.49 14.36v1.972zm2.888 5.04v-6.534l5.776-5.776v7.011zm12.708.025l-5.776-5.15V9.061l5.776 5.776zm2.889-5.065H19.51V14.36l-6.115-6.115h7.848z"
            />
          </svg>
          <svg v-else-if="link.icon === 'grok'" viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"
            />
          </svg>
        </div>
        <span>{{ link.text }}</span>
      </a>
    </div>
  </div>
</template>

<style scoped>
.ask-ai-section {
  text-align: center;
  margin: 4rem auto 2rem;
  max-width: 900px;
  padding: 0 16px;
}

.title {
  margin: 0 0 24px;
  font-weight: 600;
  font-size: 1.25em;
  color: var(--vp-c-text-1);
}

.buttons-container {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

.ask-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  border: 1.5px solid var(--vp-c-bg-soft-mute);
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none !important;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
}

.ask-btn:hover {
  transform: translateY(-3px);
  border-color: var(--btn-hover-color);
  background: var(--vp-c-bg);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
  color: var(--btn-hover-color);
}

:global(.dark) .ask-btn:hover {
  border-color: var(--btn-hover-color-dark, var(--btn-hover-color));
  color: var(--btn-hover-color-dark, var(--btn-hover-color));
}

.icon-wrapper {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-wrapper svg {
  width: 100%;
  height: 100%;
}

@media (max-width: 640px) {
  .ask-btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
