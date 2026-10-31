# 폴더

사이드바의 폴더로 대화를 정리합니다. 끌어다 놓으면 정리되고, 폴더는 3단계까지 중첩할 수 있으며, 다른 기기에서도 같은 폴더를 쓸 수 있습니다. 컴퓨터와 Android 휴대폰에서 모두 작동합니다.

<SiteSupport feature="folders" :labels="{ folders: '사이드바 폴더', 'hide-filed': '정리한 대화 숨기기', activity: 'Activity 보기', 'account-isolation': '계정 분리', projects: '폴더를 프로젝트로', 'ai-organize': 'AI 정리', 'move-menu': '대화 메뉴의 **폴더로 이동**', 'library-drag': 'Library 표에서 끌어 놓기', 'gem-icons': 'Gem 종류에 따른 대화 아이콘' }" :only="[{ id: 'move-menu', sites: ['gemini', 'chatgpt', 'claude'] }, { id: 'library-drag', sites: ['aistudio'] }, { id: 'gem-icons', sites: ['gemini'] }]" />

<GuideHero src="/assets/gemini-folders.png" alt="사이드바의 폴더 영역">

폴더 영역은 사이드바의 대화 목록 위에 있습니다. 사이드바를 닫아 두었을 때는 같은 폴더를 플로팅 패널에서 쓸 수 있습니다.

</GuideHero>

## 대화를 폴더에 넣기

<GuideOp>

사이드바의 대화는 모두 폴더에 넣을 수 있고, 한 대화를 여러 폴더에 넣을 수도 있습니다.

- **끌어 놓기**: 사이드바의 대화를 폴더 위로 끌어 놓습니다.
- **대화 메뉴**: 지원하는 사이트에서는 대화 자체 메뉴에서 **폴더로 이동**을 고릅니다.
- **여러 개 선택**: 폴더 안의 대화를 길게 누르면 여러 개를 선택해 한꺼번에 옮길 수 있습니다.
- **AI Studio**: 사이드바는 아직 여러 개 선택을 지원하지 않습니다. Library 표에서 대화를 폴더로 끌어 놓을 수 있습니다.

</GuideOp>

## 중첩과 이름 바꾸기

<GuideOp side="end">

<GuideShot src="/assets/folders-nested-en.png" alt="3단계로 중첩한 폴더" :width="240" />

폴더는 3단계까지 만들 수 있습니다. 최상위 폴더 아래에 하위 폴더를 두 단계 더 둘 수 있습니다.

- **하위 폴더**: 폴더를 오른쪽 클릭해 메뉴에서 하위 폴더를 만듭니다.
- **이름 바꾸기**: 폴더 이름을 더블클릭하거나 오른쪽 클릭 메뉴에서 **이름 바꾸기**를 고릅니다.
- **접기**: 폴더 앞의 화살표로 안의 내용을 접거나 펼칩니다.

</GuideOp>

### 메뉴와 색

<GuideOp side="end">

<GuideShot src="/assets/folders-menu-en.png" alt="폴더의 오른쪽 클릭 메뉴와 색" :width="254" />

폴더를 오른쪽 클릭하면 할 수 있는 작업이 모두 메뉴에 있습니다.

- **고정**: 폴더를 맨 위에 둡니다.
- **색**: 7가지 색 중 하나를 고릅니다.
- **삭제**: 안의 내용까지 폴더를 지웁니다. 지우기 전에 확인합니다.

</GuideOp>

<GuideNote>

**표시 설정**: 폴더 머리글의 톱니바퀴에서 대화 정렬(수동 정렬 또는 최근에 연 순서)을 바꾸고 글자 크기, 폴더 간격, 하위 폴더 들여쓰기를 조정할 수 있습니다. 팝업의 **폴더 간격**에서도 조정할 수 있습니다. Mac Safari에서는 변경 사항을 보려면 페이지를 새로 고쳐야 할 수 있습니다.

</GuideNote>

## 정리한 대화 숨기기

<GuideOp>

폴더에 넣은 대화를 메인 목록에서 빼서 진행 중인 대화만 남길 수 있습니다.

- **Gemini와 AI Studio**: 팝업 → **폴더 옵션** → **보관된 대화 숨기기**를 켭니다. 두 사이트의 설정은 따로 저장되며, AI Studio에서는 Library 표의 행이 숨겨집니다.
- **처음 정리할 때**: 이 두 사이트에서는 처음으로 대화를 폴더에 넣으면 폴더 영역에 카드가 나타나 한 번에 켤 수 있습니다. **나중에**를 고르면 다시 묻지 않습니다.
- **다른 사이트**: 팝업 **플러그인** 영역의 폴더 플러그인 설정에 스위치가 있으며, 기본값은 꺼짐입니다.
- **삭제되지 않음**: 대화는 언제나 폴더 안에 있습니다. 스위치도 언제든 끌 수 있습니다.

</GuideOp>

## 동기화와 이전

<GuideFacts>
<GuideFact title="가져오기와 내보내기">

폴더 머리글의 폴더 아이콘에 **폴더 가져오기**와 **폴더 내보내기**가 있습니다. 내보내기는 JSON 파일로 저장하고, 가져오기는 기존 폴더와 병합하므로 이미 정리한 분류는 그대로 남습니다.

<GuideShot src="/assets/folders-transfer-en.png" alt="폴더 가져오기와 내보내기" :width="160" />

</GuideFact>
<GuideFact title="계정 분리">

Gemini 사이드바의 사람 모양 버튼은 현재 Google 계정의 대화만 잠시 보여 줍니다(기본값은 꺼짐). 팝업 **폴더 옵션**의 **Enable Hard Isolation**을 켜면 폴더와 클라우드 동기화 데이터가 계정별로 나뉘고, 사람 모양 버튼은 자동으로 숨겨집니다.

</GuideFact>
<GuideFact title="클라우드 동기화">

폴더가 있는 모든 사이트에서 클라우드 동기화로 다른 컴퓨터에 같은 폴더를 가져올 수 있습니다. 폴더는 사이트마다 따로 저장되고 따로 동기화됩니다.

[클라우드 동기화 설정하기](/ko/guide/cloud-sync)

</GuideFact>
<GuideFact title="Activity 보기">

폴더 머리글의 종 버튼을 누르면 트리가 읽기 전용 Activity 보기로 바뀌어, 최근 며칠의 대화를 마지막 실제 대화 시각 순으로 보여 줍니다. 다시 누르면 트리로 돌아옵니다. 대화를 옮기거나 복사하거나 다시 분류하지 않습니다.

[Activity 보기 전체 설명](/ko/guide/activity-view)

</GuideFact>
</GuideFacts>

## AI 정리

대화가 너무 많아 손으로 나누기 어렵다면 Gemini에게 폴더 구성을 제안받을 수 있습니다.

<GuideSteps>
<GuideStep>

Gemini에서 팝업을 열고 **폴더 옵션** 아래쪽의 **AI 정리**를 누릅니다. 아직 분류하지 않은 대화와 지금의 폴더 구조를 프롬프트로 만들어 복사합니다. 프롬프트와 폴더 이름은 설정한 언어로 만들어집니다.

<GuideShot kind="panel" src="/assets/ai-auto-folder.png" alt="팝업의 AI 정리 버튼" :width="326" />

</GuideStep>
<GuideStep>

프롬프트를 Gemini에 붙여 넣으면 JSON 형식의 폴더 구성을 답해 줍니다.

</GuideStep>
<GuideStep>

폴더 머리글에서 **폴더 가져오기**를 누르고 **또는 JSON 직접 붙여넣기**를 골라 붙여 넣은 뒤 **가져오기**를 누릅니다. 기본값은 **기존 폴더와 병합**으로, 새 폴더와 새 분류만 추가하고 기존 분류는 건드리지 않습니다.

</GuideStep>
</GuideSteps>

## 폴더를 프로젝트로

폴더에 첫 턴용 지침을 두고, 새 대화가 첫 메시지를 보낸 뒤 자동으로 그 폴더에 들어가게 할 수 있습니다. Claude Projects에서 착안했지만, Voyager는 첫 턴 지침과 자동 정리만 하며 컨텍스트를 공유하는 작업 공간은 아닙니다.

<GuideSteps>
<GuideStep>

팝업에서 **폴더를 프로젝트로 사용 활성화**를 켭니다.

</GuideStep>
<GuideStep>

폴더를 오른쪽 클릭하고 **지침 설정** 또는 **지침 편집**을 고릅니다.

</GuideStep>
<GuideStep>

새 Gemini 대화를 열고 입력창 옆의 폴더 선택기에서 그 폴더를 고릅니다.

</GuideStep>
<GuideStep>

첫 메시지를 보냅니다.

</GuideStep>
</GuideSteps>

<GuideNote>

**그다음에는**

- 첫 전송 후 대화가 그 폴더에 들어갑니다.
- 폴더에 지침이 있으면 Voyager는 첫 전송에만 잠시 덧붙입니다. 지침이 없으면 빠르게 정리하는 입구로 쓸 수 있습니다.
- 같은 폴더의 대화끼리 기억을 공유하거나 서로의 내용을 읽지 **않습니다**.
- 임시 저장은 입력한 본문만 남기며, 숨겨진 지침을 입력창에 다시 넣지 않습니다.

</GuideNote>

사이드바 너비는 [사이드바 너비](/ko/guide/sidebar)를 참고하세요.
