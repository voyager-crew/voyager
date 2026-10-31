import type { DefaultTheme, LocaleSpecificConfig } from 'vitepress';

import { announcementNav } from '../announcementNav';

const locale: LocaleSpecificConfig<DefaultTheme.Config> & { label: string; link?: string } = {
  label: '한국어',
  lang: 'ko-KR',
  link: '/ko/',
  themeConfig: {
    nav: [
      ...announcementNav('공지'),
      { text: '홈', link: '/ko/' },
      { text: '가이드', link: '/ko/guide/installation' },
      { text: '데이터 뷰어', link: '/ko/data-viewer' },
    ],
    sidebar: [
      {
        text: '소개',
        items: [
          { text: '설치', link: '/ko/guide/installation' },
          { text: '시작하기', link: '/ko/guide/getting-started' },
          { text: 'Voyager 패널', link: '/ko/guide/panel' },
        ],
      },
      {
        text: '핵심 기능',
        items: [
          { text: '폴더 관리', link: '/ko/guide/folders' },
          { text: 'Activity 보기', link: '/ko/guide/activity-view' },
          { text: '프롬프트 라이브러리', link: '/ko/guide/prompts' },
          { text: '클라우드 동기화', link: '/ko/guide/cloud-sync' },
          { text: '타임라인 탐색', link: '/ko/guide/timeline' },
          { text: '대화 내보내기', link: '/ko/guide/export' },
          { text: '인용 답장', link: '/ko/guide/quote-reply' },
          { text: 'Canvas를 Markdown으로 복사', link: '/ko/guide/canvas-copy' },
          { text: '전송 동작', link: '/ko/guide/send-behavior' },
          { text: '수식 복사', link: '/ko/guide/formula-copy' },
          { text: '사이드바 너비', link: '/ko/guide/sidebar' },
        ],
      },
      {
        text: 'Gemini & AI Studio',
        items: [
          { text: '대화 분기 (실험적)', link: '/ko/guide/fork' },
          { text: '나만의 것으로 만들기', link: '/ko/guide/settings' },
          { text: '일괄 삭제', link: '/ko/guide/batch-delete' },
          { text: 'Deep Research 내보내기', link: '/ko/guide/deep-research' },
          { text: 'Mermaid 다이어그램 렌더링', link: '/ko/guide/mermaid' },
          { text: 'Markdown 렌더링 수정', link: '/ko/guide/markdown-fix' },
          { text: 'NanoBanana (워터마크 제거)', link: '/ko/guide/nanobanana' },
          { text: '사이드바 자동 숨김', link: '/ko/guide/sidebar-auto-hide' },
          { text: '자동 스크롤 방지', link: '/ko/guide/prevent-auto-scroll' },
          { text: '입력창 접기', link: '/ko/guide/input-collapse' },
          { text: '사이드바의 최근 Gems', link: '/ko/guide/gems-sidebar' },
          { text: '사용량 상태 바', link: '/ko/guide/usage-status' },
          { text: '기본 모델', link: '/ko/guide/default-model' },
          { text: 'IDE 컨텍스트 동기화 (실험적)', link: '/ko/guide/context-sync' },
          { text: '사용자 메시지 LaTeX 렌더링', link: '/ko/guide/user-latex' },
          { text: '메시지 타임스탬프', link: '/ko/guide/timestamp' },
          { text: '글꼴 크기', link: '/ko/guide/chat-font-size' },
        ],
      },
      {
        text: '플러그인',
        items: [
          { text: '플러그인 목록', link: '/ko/guide/plugins' },
          { text: 'ChatGPT 로컬 브리지', link: '/ko/guide/local-bridge' },
          { text: '직접 플러그인 만들기', link: '/ko/guide/write-a-plugin' },
          { text: '플러그인 기여 가이드', link: '/ko/guide/plugin-contribution' },
          { text: '새 플랫폼 추가하기', link: '/ko/guide/adding-a-platform' },
          { text: 'DOM 작업 범위', link: '/ko/guide/dom-operation-boundaries' },
        ],
      },
      {
        text: '로컬 Web UI',
        items: [{ text: 'DeepSeek Harness', link: '/ko/guide/deepseek-harness' }],
      },
      {
        text: '더 보기',
        items: [
          { text: '커뮤니티', link: '/ko/guide/community' },
          { text: '후원', link: '/ko/guide/sponsor' },
          { text: '에코시스템', link: '/ko/guide/ecosystem' },
          { text: '변경 로그', link: '/ko/changelog' },
        ],
      },
    ],
    footer: {
      message:
        '오픈 소스 프로젝트입니다. 마음에 드신다면 <a href="https://github.com/voyager-crew/voyager" target="_blank">GitHub</a>에서 ⭐를 눌러주세요.',
      copyright:
        'GPLv3 라이선스 하에 배포됨 | Copyright © 2026 Jesse Zhang | <a href="/ko/privacy">개인정보 처리방침</a> | <a href="/ko/changelog">변경 로그</a>',
    },
  },
};

export default locale;
