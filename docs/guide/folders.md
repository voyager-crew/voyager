# 文件夹

把对话收进侧边栏里的文件夹：拖进去就归档好了，文件夹可以套三层，换一台设备也能同步回来。电脑和安卓手机上都能用。

<SiteSupport feature="folders" :labels="{ folders: '侧边栏文件夹', 'hide-filed': '隐藏已归档对话', activity: 'Activity 视图', 'account-isolation': '账号隔离', projects: '文件夹即项目', 'ai-organize': 'AI 整理', 'move-menu': '对话菜单里的 **移动到文件夹**', 'library-drag': '从 Library 表格拖进文件夹', 'gem-icons': '按 Gem 类型显示的对话图标' }" :only="[{ id: 'move-menu', sites: ['gemini', 'chatgpt', 'claude'] }, { id: 'library-drag', sites: ['aistudio'] }, { id: 'gem-icons', sites: ['gemini'] }]" />

<GuideHero src="/assets/gemini-folders.png" alt="侧边栏里的文件夹区域">

文件夹区域在侧边栏的对话列表上方。侧边栏收起时，同一套文件夹也能在悬浮面板里用。

</GuideHero>

## 把对话放进文件夹

<GuideOp>

侧边栏里的对话都能放进文件夹，同一条对话也可以放进几个文件夹。

- **拖拽**：把侧边栏里的对话拖到文件夹上。
- **对话菜单**：在支持的网站上，打开对话自己的菜单，选 **移动到文件夹**。
- **多选**：长按文件夹里的一条对话进入多选，再一起移动。
- **AI Studio**：侧边栏暂不支持多选；可以从 Library 表格把对话拖进文件夹。

</GuideOp>

## 嵌套与改名

<GuideOp side="end">

<GuideShot src="/assets/folders-nested-zh.png" alt="三层嵌套的文件夹" :width="240" />

文件夹最多三层：顶层文件夹下面还能再建两级子文件夹。

- **子文件夹**：右键文件夹，在菜单里新建子文件夹。
- **改名**：双击文件夹名，或在右键菜单里选 **重命名**。
- **折叠**：点文件夹前的箭头，收起或展开它下面的内容。

</GuideOp>

### 右键菜单与颜色

<GuideOp side="end">

<GuideShot src="/assets/folders-menu-zh.png" alt="文件夹右键菜单和颜色" :width="206" />

右键文件夹，所有操作都在菜单里。

- **置顶**：让这个文件夹排在最前面。
- **颜色**：7 种颜色任选一种。
- **删除**：连同里面的内容一起删掉，会先确认。

</GuideOp>

<GuideNote>

**显示设置**：文件夹标题栏的齿轮里可以切换会话排序（手动排序或最近打开），并调整字号、文件夹间距和子文件夹缩进；弹窗的 **文件夹间距** 也能调。Mac Safari 上调整后可能要刷新页面才生效。

</GuideNote>

## 隐藏已归档对话

<GuideOp>

对话放进文件夹后，可以让它不再出现在主列表里，主列表只留进行中的对话。

- **Gemini 和 AI Studio**：打开弹窗 → **文件夹选项** → **隐藏已归档对话**。两边的设置互相独立；AI Studio 上隐藏的是 Library 表格里的行。
- **第一次归档**：在这两个网站上，你第一次把对话放进文件夹时，文件夹区域会弹出一张卡片，一键就能开启；点 **暂不开启** 就不会再提示。
- **其他网站**：这个开关在弹窗 **插件** 区域文件夹插件的设置里，默认关闭。
- **不会删除**：对话随时能在文件夹里找到；开关也随时可以关掉。

</GuideOp>

## 同步与迁移

<GuideFacts>
<GuideFact title="导入与导出">

文件夹标题栏的文件夹图标里有 **导入文件夹** 和 **导出文件夹**。导出得到一个 JSON 文件；导入时会与现有文件夹合并，不会打乱已有的分类。

<GuideShot src="/assets/folders-transfer-zh.png" alt="导入和导出文件夹" :width="160" />

</GuideFact>
<GuideFact title="账号隔离">

Gemini 侧栏的人像按钮只临时显示当前 Google 账号的对话，默认关闭。弹窗 **文件夹选项** 里的 **启用硬隔离（Hard Isolation）** 会按账号拆分文件夹和云同步数据；开启后人像按钮会自动隐藏。

</GuideFact>
<GuideFact title="云同步">

每个有文件夹的网站都能用云同步在另一台电脑上拿回同样的文件夹。各网站的文件夹分开保存、分开同步。

[设置云同步](/guide/cloud-sync)

</GuideFact>
<GuideFact title="Activity 视图">

点文件夹标题栏的铃铛，目录会换成只读的 Activity 视图，按最近一次真实对话的时间列出近几天的对话；再点一次回到文件夹树。它不会移动、复制或重新分类任何对话。

[Activity 视图的完整说明](/guide/activity-view)

</GuideFact>
</GuideFacts>

## AI 整理

对话太多不想手动分，可以让 Gemini 给出一份文件夹方案。

<GuideSteps>
<GuideStep>

在 Gemini 上打开弹窗，点 **文件夹选项** 底部的 **AI 整理**。它会把未归类的对话和现有文件夹结构写成一段提示词，复制到剪贴板；提示词和文件夹名都用你设置的语言。

<GuideShot kind="panel" src="/assets/ai-auto-folder.png" alt="弹窗里的 AI 整理按钮" :width="326" />

</GuideStep>
<GuideStep>

把提示词粘贴给 Gemini，它会回复一段 JSON 格式的文件夹方案。

</GuideStep>
<GuideStep>

在文件夹标题栏点 **导入文件夹**，选 **或直接粘贴 JSON**，粘贴后点 **导入**。默认 **与现有文件夹合并**，只添加新文件夹和新分配，不动已有的分类。

</GuideStep>
</GuideSteps>

## 文件夹即项目

让某个文件夹带上一套首轮指令，新对话发出第一条消息后自动归进去。思路参考了 Claude Projects，但 Voyager 只做首轮指令加自动归档，不是共享上下文的工作区。

<GuideSteps>
<GuideStep>

在弹窗中开启 **启用文件夹作为项目**。

</GuideStep>
<GuideStep>

右键一个文件夹，选 **设置指令** 或 **编辑指令**。

</GuideStep>
<GuideStep>

打开一个新的 Gemini 对话，在输入框旁的文件夹选择器里选中它。

</GuideStep>
<GuideStep>

发送第一条消息。

</GuideStep>
</GuideSteps>

<GuideNote>

**之后**

- 第一次发送后，对话自动归入这个文件夹。
- 文件夹有指令时，Voyager 只在第一次发送时临时附上这些指令；没有指令时，它就是一个快速归档入口。
- 同一文件夹里的对话 **不** 共享记忆，也不会互相读取内容。
- 草稿自动保存只保留你输入的正文，不会把隐藏的指令放回输入框。

</GuideNote>

侧边栏宽度见 [侧边栏宽度](/guide/sidebar)。
