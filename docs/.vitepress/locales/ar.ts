import type { DefaultTheme, LocaleSpecificConfig } from 'vitepress';

import { announcementNav } from '../announcementNav';

const locale: LocaleSpecificConfig<DefaultTheme.Config> & { label: string; link?: string } = {
  label: 'العربية',
  lang: 'ar-SA',
  link: '/ar/',
  dir: 'rtl',
  themeConfig: {
    nav: [
      ...announcementNav('إعلان'),
      { text: 'الرئيسية', link: '/ar/' },
      { text: 'الدليل', link: '/ar/guide/installation' },
      { text: 'عارض البيانات', link: '/ar/data-viewer' },
    ],
    sidebar: [
      {
        text: 'مقدمة',
        items: [
          { text: 'التثبيت', link: '/ar/guide/installation' },
          { text: 'البدء', link: '/ar/guide/getting-started' },
          { text: 'لوحة Voyager', link: '/ar/guide/panel' },
        ],
      },
      {
        text: 'الميزات الأساسية',
        items: [
          { text: 'المجلدات', link: '/ar/guide/folders' },
          { text: 'عرض Activity', link: '/ar/guide/activity-view' },
          { text: 'مكتبة المطالبات', link: '/ar/guide/prompts' },
          { text: 'مزامنة السحابية', link: '/ar/guide/cloud-sync' },
          { text: 'تصفح الجدول الزمني', link: '/ar/guide/timeline' },
          { text: 'تصدير الدردشة', link: '/ar/guide/export' },
          { text: 'الرد مع اقتباس', link: '/ar/guide/quote-reply' },
          { text: 'نسخ Canvas بصيغة Markdown', link: '/ar/guide/canvas-copy' },
          { text: 'سلوك الإرسال', link: '/ar/guide/send-behavior' },
          { text: 'نسخ الصيغ', link: '/ar/guide/formula-copy' },
          { text: 'عرض الشريط الجانبي', link: '/ar/guide/sidebar' },
        ],
      },
      {
        text: 'Gemini & AI Studio',
        items: [
          { text: 'تفريع المحادثة (تجريبي)', link: '/ar/guide/fork' },
          { text: 'اجعله على طريقتك', link: '/ar/guide/settings' },
          { text: 'الحذف الجماعي', link: '/ar/guide/batch-delete' },
          { text: 'تصدير البحث العميق', link: '/ar/guide/deep-research' },
          { text: 'رسوم بيانية Mermaid', link: '/ar/guide/mermaid' },
          { text: 'إصلاح عرض Markdown', link: '/ar/guide/markdown-fix' },
          { text: 'NanoBanana', link: '/ar/guide/nanobanana' },
          { text: 'إخفاء الشريط الجانبي تلقائياً', link: '/ar/guide/sidebar-auto-hide' },
          { text: 'منع التمرير التلقائي', link: '/ar/guide/prevent-auto-scroll' },
          { text: 'طي الإدخال', link: '/ar/guide/input-collapse' },
          {
            text: 'Gems الأخيرة في الشريط الجانبي',
            link: '/ar/guide/gems-sidebar',
          },
          { text: 'شريط حالة الاستخدام', link: '/ar/guide/usage-status' },
          { text: 'النموذج الافتراضي', link: '/ar/guide/default-model' },
          { text: 'مزامنة السياق (تجريبي)', link: '/ar/guide/context-sync' },
          { text: 'عرض LaTeX في رسائل المستخدم', link: '/ar/guide/user-latex' },
          { text: 'طابع الوقت', link: '/ar/guide/timestamp' },
          { text: 'حجم الخط', link: '/ar/guide/chat-font-size' },
        ],
      },
      {
        text: 'الإضافات',
        items: [
          { text: 'كل الإضافات', link: '/ar/guide/plugins' },
          { text: 'الجسر المحلي لـ ChatGPT', link: '/ar/guide/local-bridge' },
          { text: 'اكتب إضافتك الخاصة', link: '/ar/guide/write-a-plugin' },
          { text: 'المساهمة في الإضافات', link: '/ar/guide/plugin-contribution' },
          { text: 'إضافة منصة جديدة', link: '/ar/guide/adding-a-platform' },
          { text: 'حدود عمليات DOM', link: '/ar/guide/dom-operation-boundaries' },
        ],
      },
      {
        text: 'واجهة ويب محلية',
        items: [{ text: 'DeepSeek Harness', link: '/ar/guide/deepseek-harness' }],
      },
      {
        text: 'المزيد',
        items: [
          { text: 'المجتمع', link: '/ar/guide/community' },
          { text: 'رعاية', link: '/ar/guide/sponsor' },
          { text: 'المنظومة', link: '/ar/guide/ecosystem' },
          { text: 'سجل التغييرات', link: '/ar/changelog' },
        ],
      },
    ],
    footer: {
      message:
        'مشروع مفتوح المصدر. امنحنا ⭐ على <a href="https://github.com/voyager-crew/voyager" target="_blank">GitHub</a> إذا أعجبك.',
      copyright:
        'رخصة GPLv3 | حقوق النشر © 2026 Jesse Zhang | <a href="/ar/privacy">سياسة الخصوصية</a> | <a href="/ar/changelog">سجل التغييرات</a>',
    },
  },
};

export default locale;
