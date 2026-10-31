# ✨ 주요 기능

## 🌌 공통 (Gemini & AI Studio)

- **📂 [폴더 관리](https://voyager.nagi.fun/ko/guide/folders)**: 드래그 앤 드롭을 지원하는 최대 3단계 폴더 계층 구조로 대화를 정리하세요.
  - **Gemini**: **계정 분리 모드** 및 **사용자 지정 폴더 색상**을 지원합니다.
- **💡 [프롬프트 저장소](https://voyager.nagi.fun/ko/guide/prompts)**: Gemini, AI Studio 및 [사용자 지정 웹사이트](https://voyager.nagi.fun/ko/guide/prompts#어디서나-사용-가능)에서 프롬프트를 저장하고 재사용하세요.
- **☁️ [클라우드 동기화](https://voyager.nagi.fun/ko/guide/cloud-sync)**: Google Drive를 통해 폴더와 프롬프트를 동기화하거나, Safari에서는 iCloud를 사용하세요.
- **🗑️ [일괄 삭제](https://voyager.nagi.fun/ko/guide/batch-delete)**: 여러 대화를 한꺼번에 삭제합니다.
- **📐 [수식 복사](https://voyager.nagi.fun/ko/guide/formula-copy)**: 수식을 클릭해 LaTeX, MathML(Word), 또는 Notion용 수식으로 복사하세요.

## ✨ Gemini 전용 기능

- **📍 [타임라인 탐색](https://voyager.nagi.fun/ko/guide/timeline)**: 시각적 노드를 통해 메시지 간 이동, 주요 순간 별표 표시, 대화 브랜치 관리를 수행하세요.
- **💾 [대화 내보내기](https://voyager.nagi.fun/ko/guide/export)**: 이미지를 포함해 대화를 JSON, Markdown, PDF 또는 이미지로 내보내세요.
- **🧜‍♀️ [Mermaid 렌더링](https://voyager.nagi.fun/ko/guide/mermaid)**: 플로우차트, 시퀀스 다이어그램 및 기타 Mermaid 차트를 자동으로 렌더링합니다.
- **📝 [Markdown 렌더링 수정](https://voyager.nagi.fun/ko/guide/markdown-fix)**: Gemini 가 삽입한 HTML 요소로 인해 깨진 굵게 표시 (bold) 구문을 자동으로 수정합니다.
- **🍌 [Image Refinement](https://voyager.nagi.fun/ko/guide/nanobanana)**: Gemini 에서 생성된 이미지의 워터마크를 무손실로 제거합니다.
- **🔬 [Deep Research](https://voyager.nagi.fun/ko/guide/deep-research)**: Deep Research 세션에서 생각 과정과 연구 링크를 추출합니다.
- **🛠️ 파워 툴**:
  - **[인용 답장](https://voyager.nagi.fun/ko/guide/quote-reply)**: 텍스트를 선택하여 문맥과 함께 답장합니다.
  - **[자동 스크롤 방지](https://voyager.nagi.fun/ko/guide/prevent-auto-scroll)**: 새로운 프롬프트를 전송할 때 발생하는 원치 않는 점프 동작을 차단합니다.
  - **[입력창 접기](https://voyager.nagi.fun/ko/guide/input-collapse)**: 더 많은 읽기 공간을 위해 자동으로 확장되는 입력 영역을 제공합니다.
  - **[기본 모델](https://voyager.nagi.fun/ko/guide/default-model)**: 좋아하는 모델을 기본값으로 설정하세요.

## 🔌 Claude, ChatGPT, DeepSeek & Kimi

[Voyager 플러그인 엔진](https://voyager.nagi.fun/ko/guide/plugins)을 기반으로, 이 기능들은 Gemini를 넘어 사용 경험을 확장합니다. 확장 프로그램 팝업에서 켜고, 각 사이트에 대한 접근을 허용하세요.

- **📍 타임라인**: ChatGPT, Claude, DeepSeek에서 별표 메시지와 검색을 갖춘 같은 타임라인을 제공합니다. 직접 켜기 전까지는 꺼져 있습니다.
- **📂 폴더**: ChatGPT, Claude, DeepSeek, Kimi에서 대화를 폴더로 정리합니다. ChatGPT 폴더는 기본으로 켜져 있습니다.
- **💾 내보내기**: ChatGPT, Claude, DeepSeek, Kimi에서 대화를 Markdown, JSON, PDF 또는 이미지로 내보냅니다.
- **📐 수식 복사**: Claude, ChatGPT, DeepSeek에서 수식을 클릭해 LaTeX를 복사합니다.
- **⌨️ Vim 입력**: Claude, ChatGPT, DeepSeek 입력창에서 Vim 방식의 모달 편집과 커서 이동을 지원합니다.
- **📖 편안한 읽기 너비**: Claude, ChatGPT, DeepSeek, Kimi의 대화 너비를 조절하여 더 나은 읽기 경험 제공.
- **💬 일상 도우미**: Claude, ChatGPT, DeepSeek, Kimi에서 인용 답장, Ctrl/⌘+Enter 전송, 초안 글자 수 표시를 제공합니다. Claude, DeepSeek, Kimi에서는 초안 자동 저장도 지원합니다.
- **🈶 CJK 렌더링 수정**: Claude에서의 한중일 문자 렌더링 문제 수정.
- **📜 코드 줄바꿈 해제**: DeepSeek에서 긴 코드 줄을 줄바꿈하지 않고 가로 스크롤하여 들여쓰기를 유지.

## 🧩 모든 사이트 — localhost 까지

팝업에서 원하는 사이트를 추가하면 Prompt Manager가 그곳까지 따라갑니다. 로컬 앱도 마찬가지입니다. 아래는 `localhost:3080`에서 실행 중인 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 안의 모습입니다:

<p align="center">
  <img src="../../../docs/public/assets/prompt-manager-deepseek-harness.png" alt="DeepSeek Harness 안에서 실행 중인 Prompt Manager" width="720">
</p>

## 🎨 개인화

- **🌦️ 시각 효과**: **눈**, **시네마틱 비**, **벚꽃잎** 효과로 Voyager가 동작하는 모든 사이트에 계절 분위기를 더하세요.
- Gemini와 AI Studio에서는 확장 프로그램 팝업에서 **페이지 레이아웃** → **시각 효과**를 켠 다음 그 행 아래에서 `눈`, `벚꽃`, `비` 중 하나를 고르세요. 끄면 효과도 꺼집니다. Claude, ChatGPT, DeepSeek, 사용자 지정 사이트에서는 같은 행이 해당 사이트의 **플러그인** 카드에 있습니다.
- 효과는 가벼운 전체 화면 오버레이로 렌더링되며, 페이지 상호작용을 차단하지 않습니다.
- 효과를 전환하거나 끄면 파티클이 갑자기 사라지는 대신 자연스럽게 사라집니다.
