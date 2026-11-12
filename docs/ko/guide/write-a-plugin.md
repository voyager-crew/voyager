# 직접 플러그인 만들기

한 문장으로 플러그인을 만들려면 [창작 모드](./create-mode.md)를 보세요. 그 사이트의 AI가 플러그인을 작성하고, Voyager가 검사한 뒤 설치해 줍니다. 이 페이지에서는 나머지 두 가지 방법인 내 컴퓨터의 코딩 에이전트에게 맡기는 방법과 직접 작성하는 방법, 그리고 플러그인 형식의 규칙을 다룹니다.

로컬 플러그인은 나를 위해 직접 만드는 플러그인입니다. Gemini, AI Studio, ChatGPT, Claude, DeepSeek, Kimi의 모양이나 레이아웃을 바꾸며, 내 브라우저 안에만 저장됩니다. PR을 보낼 필요도, Voyager 소스 코드를 받아 둘 필요도 없습니다.

대부분의 플러그인은 선언형입니다. `plugin.json` 매니페스트와 CSS로만 이루어지고, 스스로는 어떤 코드도 실행하지 않습니다. Voyager가 가져올 때 내용을 검사하고 변경 사항을 적용하며, 끄면 모든 변경을 되돌립니다. 가져온 플러그인은 꺼진 상태로 시작하므로 먼저 살펴본 뒤 켤 수 있습니다. 요청에 코드가 필요하면 대신 [코드를 실행하는 창작물](./create-mode.md#코드를-실행하는-창작물)을 만드세요.

두 방법 모두 **내 창작물**에서 마무리됩니다. **다른 추가 방법**을 펼치고 **파일 가져오기**를 선택해 `plugin.json`과 `style.css`를 고르세요.

## 로컬 에이전트용으로 복사

코딩 에이전트(Claude Code, Codex, Cursor 등)를 쓴다면 패널의 **만들기** 탭이나 팝업의 **내 창작물**에 한 문장을 쓰고, **로컬 에이전트용으로 복사**를 선택해 그 텍스트를 에이전트에게 건네주세요. 텍스트는 에이전트에게 Voyager의 플러그인 skill을 따르라고 요청합니다.

```text
https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md
```

이 skill에는 매니페스트 필드, 사이트마다 선언된 내용, 프리미티브, 플러그인이 할 수 없는 일까지 규격 전체가 담겨 있습니다. 에이전트는 `plugin.json`과 `style.css`를 작성하고, `npx create-voyager-plugin@latest check`가 통과할 때까지 실행한 뒤 두 파일을 돌려줍니다. 그 파일을 **파일 가져오기**로 추가하세요.

skill을 계속 설치해 두려면 에이전트의 skills 폴더에 `write-voyager-plugin/SKILL.md`로 저장하세요(Claude Code라면 `~/.claude/skills/`).

## 직접 작성하기

Node.js 18 이상이 필요합니다.

```sh
npx create-voyager-plugin@latest init my-plugin --site claude
# my-plugin/plugin.json과 my-plugin/style.css 편집
npx create-voyager-plugin@latest check my-plugin
```

`init`은 이미 검사를 통과하는 `plugin.json`과 `style.css`, 그리고 해당 사이트의 규칙을 담은 `AGENTS.md`를 만들어 줍니다. `--site`에는 `gemini`, `aistudio`, `chatgpt`, `claude`, `deepseek`, `kimi` 중 하나를 넣습니다.

`check`는 팝업에서 가져올 때와 같은 검사를 오프라인으로 실행합니다. 가져올 수 있는 플러그인이면 종료 코드 0으로 끝나고, 그렇지 않으면 문제마다 `path: message` 한 줄을 출력합니다. `--json`을 붙이면 기계가 읽을 수 있는 형식으로 출력합니다.

검사를 통과하면 같은 방식으로 **다른 추가 방법**의 **파일 가져오기**로 두 파일을 가져오세요.

## 플러그인이 할 수 있는 일

- CSS 추가. 적용 범위는 플러그인이 페이지에 붙이는 `gv-` 클래스 아래로 한정됩니다.
- 클래스 추가, 안전한 속성이나 인라인 스타일 설정, 요소 숨기기. 대상은 사이트가 선언한 시맨틱 키(`userTurn`, `assistantTurn`, `composer` 등)나 CSS 선택자입니다.
- 팝업에 설정 제공: 스위치, 슬라이더, 드롭다운이며, 설정값은 `{{key}}` 토큰으로 CSS에 전달됩니다.
- ChatGPT, Claude, DeepSeek, Kimi에서는 Voyager 프리미티브(수식 복사, 타임라인, Mermaid 다이어그램 등)를 켜고 Voyager 자체 UI의 색을 바꿀 수 있습니다. 어느 사이트에서든 `:root`에 둔 `--gv-theme-*` 변수로 Voyager 색을 바꿀 수 있습니다. [창작 모드](./create-mode.md#voyager-색-바꾸기)를 참고하세요.

## 할 수 없는 일

선언형 플러그인은 JavaScript를 실행하거나, 클릭이나 키 입력에 반응하거나, 네트워크에서 무언가(글꼴, 이미지, 스타일시트)를 불러오거나, 메시지 내용을 읽거나 고쳐 쓰거나, 다른 사이트에서 실행될 수 없습니다. 코드로만 할 수 있는 일이라면 대신 코드를 실행하는 창작물을 만드세요. 어떤 창작물도 다른 사이트에서 실행되거나 Voyager 자체 설정을 바꿀 수는 없습니다. 이런 요청이면 작성 자료가 AI에게 그 사실을 분명히 말하고 실제로 가능한 가장 가까운 형태로 만들도록 안내합니다.

## 가져올 때 검사하는 규칙

공통 매니페스트 검사([플러그인 기여 가이드](./plugin-contribution.md) 참고) 외에도 로컬 플러그인은 다음을 지켜야 합니다.

- Voyager가 지원하는 사이트 범위 안의 URL만 매칭할 것
- 매칭되는 모든 사이트가 선언한 시맨틱 키만 사용할 것
- `addClass` 하나에 클래스는 정확히 하나이며, `gv-`로 시작할 것
- 설정은 boolean, number, select만 사용할 것(string과 color는 아직 팝업에 대응하는 컨트롤이 없습니다)
- Gemini와 AI Studio에서는 `theme`을 쓰지 않고, 프리미티브는 각 사이트가 허용하는 것만 쓸 것: Gemini에서는 `formulaCopy`, `vimInput`, `userLatex`, `codeCollapse`, `mermaid`, `wavedrom`, `echarts`, `sendShortcut`, `draftSave`, `turnNavigator`, AI Studio에서는 `formulaCopy`, `sendShortcut`. 모두 Voyager 자체의 해당 설정과 같은 코드를 실행함. `formulaCopy`와 `vimInput`(수식 복사·입력창 Vim 모드)은 한 페이지에서 내장 설정과 플러그인 중 하나만 실행됨. 페이지를 처음 불러올 때나 둘 다 실행 중이 아닐 때는 내장 설정이 우선하고, 그 뒤에는 이미 실행 중인 쪽이 계속 실행되며 다른 쪽은 일시 중지로 표시됨. 하나를 끄면 다른 쪽이 이어받음. `userLatex`, `codeCollapse`, `mermaid`, `wavedrom`, `echarts`는 요소 단위로 맡을 대상을 정하므로 내장 설정과 함께 실행할 수 있음: 상대가 이미 처리 중인 줄이나 코드 블록은 상대에게 맡김

번역(`i18n`)은 선택 사항입니다.

### 타임라인, 전송, 초안 프리미티브

개인용 Gemini에서는 `params.dataBackend: "shared"`와 `engine: ">=1.9.0"`을 지정해 로컬 `turnNavigator`를 사용할 수 있습니다. 공식 타임라인과 동일한 네이티브 별표 및 계층 데이터를 읽고 쓰며, 대화·계정·턴의 식별 매개변수는 재정의할 수 없습니다. 공식 **타임라인 표시** 설정과 충돌하므로 공식 설정을 먼저 끈 다음 로컬 플러그인을 켜세요. 공식 타임라인으로 돌아가려면 로컬 플러그인을 먼저 끈 다음 공식 설정을 켜세요. Business, Enterprise 및 사용자 지정 사이트 범위는 지원하지 않습니다.

모든 사이트에서 페이지마다 전송 단축키 플러그인은 하나만 실행됩니다. 전송 모드를 사용 중인 플러그인이 있으면 다른 플러그인은 충돌로 표시되고 일시 중지됩니다. 선택 사항인 `mode`(`"engine": ">=1.9.0"` 필요)는 `ctrlEnterSends`(기본값) 또는 `enterSends`입니다. IME 확인으로는 전송하지 않습니다. Gemini와 AI Studio에서도 사용할 수 있으며, 지원 모드는 아래와 같습니다.

Gemini에서는 공식 Ctrl/Cmd+Enter 전송을 `sendShortcut`으로 바꿀 수 있습니다. 공식 설정을 끈 뒤 로컬 플러그인을 켜세요. `ctrlEnterSends`만 지원하며 Enterprise에서는 동작하지 않습니다. `composerRoot`는 기본 및 편집 입력창을 포함하고 `sendButton`은 중지 버튼을 제외합니다.

AI Studio의 `sendShortcut`에는 `params.mode: "enterSends"`가 필요합니다. 공식 Enter 전송을 끄면 로컬 플러그인이 대신 실행됩니다. Ctrl/Cmd+Enter는 줄을 바꾸고 Shift/Alt+Enter는 호스트가 처리합니다.

Gemini의 `draftSave`는 공식 기능과 `gvDraft_<전체 pathname>` 기록을 공유하며 `/u/N`과 Gem 경로를 유지합니다. 꺼도 저장된 초안은 남고 같은 페이지의 여러 플러그인이 함께 사용할 수 있습니다. 종료 전에 마지막 입력을 저장하려고 하지만 브라우저가 닫힐 때 비동기 저장 완료를 보장할 수는 없습니다. 쓰기와 정리는 같은 페이지 안에서만 조정됩니다. 같은 `/u/N` 슬롯에서 이메일을 바꿔도 저장된 초안을 공유합니다.
