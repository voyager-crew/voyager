# 自分でプラグインを作る

一文からプラグインを作るなら、[作成モード](./create-mode.md)を見てください。そのサイトの AI がプラグインを書き、Voyager がチェックしてインストールします。このページでは、残りの 2 つの方法（手元のコーディングエージェントに任せる方法と、手で書く方法）と、プラグイン形式のルールを説明します。

ローカルプラグインは、自分のために作るプラグインです。Gemini、AI Studio、ChatGPT、Claude、DeepSeek、Kimi の見た目やレイアウトを変えられ、保存先は自分のブラウザの中だけ。PR を出す必要も、Voyager のソースコードを手元に用意する必要もありません。

プラグインの多くは宣言的で、`plugin.json` マニフェストと CSS だけでできており、自身でコードを実行することはありません。Voyager がインポート時に内容をチェックして変更を適用し、オフにすればすべての変更を元に戻します。インポートしたプラグインは最初オフになっているので、中身を確かめてから有効にできます。依頼にコードが必要な場合は、代わりに[コードを実行する作品](./create-mode.md#コードを実行する作品)を作ってください。

どちらの方法も最後は **マイ作品** に行き着きます。**ほかの追加方法** を開き、**ファイルをインポート** を選んで `plugin.json` と `style.css` を指定します。

## ローカルエージェント用にコピー

コーディングエージェント（Claude Code、Codex、Cursor など）を使っているなら、パネルの **作成** タブかポップアップの **マイ作品** に一文を書き、**ローカルエージェント用にコピー** を選んで、そのテキストをエージェントに渡してください。テキストは、Voyager のプラグイン skill に従うようエージェントに頼む内容です。

```text
https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md
```

skill には、マニフェストのフィールド、各サイトが宣言している内容、プリミティブ、プラグインにできないことまで、仕様がひととおり入っています。エージェントは `plugin.json` と `style.css` を書き、`npx create-voyager-plugin@latest check` が通るまで実行してから、2 つのファイルを返します。それを **ファイルをインポート** で追加してください。

skill をいつでも使えるようにしておくなら、エージェントの skills フォルダに `write-voyager-plugin/SKILL.md` として保存します（Claude Code なら `~/.claude/skills/`）。

## 手で書く

Node.js 18 以降が必要です。

```sh
npx create-voyager-plugin@latest init my-plugin --site claude
# my-plugin/plugin.json と my-plugin/style.css を編集
npx create-voyager-plugin@latest check my-plugin
```

`init` は、そのままでチェックを通る `plugin.json` と `style.css` に加えて、そのサイトのルールをまとめた `AGENTS.md` を書き出します。`--site` には `gemini`、`aistudio`、`chatgpt`、`claude`、`deepseek`、`kimi` のいずれかを指定します。

`check` はポップアップでのインポートと同じチェックをオフラインで実行します。インポートできる状態なら終了コード 0 を返し、そうでなければ問題ごとに `path: message` 形式の行を 1 行ずつ出力します。`--json` を付けると機械可読な形式で出力します。

チェックが通ったら、同じように **ほかの追加方法** の **ファイルをインポート** で 2 つのファイルをインポートします。

## プラグインにできること

- CSS を追加する。適用範囲は、プラグインがページに付ける `gv-` クラスの下に限られます。
- クラスの追加、安全な属性やインラインスタイルの設定、要素の非表示。対象には、サイトが宣言しているセマンティックキー（`userTurn`、`assistantTurn`、`composer` など）か CSS セレクタを指定します。
- ポップアップに設定項目（スイッチ、スライダー、ドロップダウン）を用意する。設定値は `{{key}}` トークンで CSS に渡されます。
- ChatGPT、Claude、DeepSeek、Kimi では、Voyager のプリミティブ（数式コピー、タイムライン、Mermaid 図など）を有効にしたり、Voyager 自身の UI の色を変えたりできます。どのサイトでも、`:root` に置いた `--gv-theme-*` 変数で Voyager の配色を変えられます。[下記](#voyager-の配色を変える)を参照してください。

## プラグインにできないこと

宣言的なプラグインには、JavaScript の実行、クリックやキー入力への反応、ネットワークからの読み込み（フォント、画像、スタイルシート）、メッセージ内容の読み取りや書き換え、ほかのサイトでの動作はできません。コードでしか実現できない場合は、代わりにコードを実行する作品を作ってください。どの作品もほかのサイトでは動作せず、Voyager 自身の設定も変えられません。そうした依頼の場合、作成用の資料は AI にそのことを正直に伝えさせ、実現できるいちばん近い形で作らせます。

## Voyager の配色を変える

ページ上の Voyager の UI は、公開されている一連の変数から色を読み取ります。プラグインはこれらを、`gv-` クラスで絞り込まない `:root` ルール 1 つで設定します。ライトでもダークでも同じように反映され、設定しなかった変数は Voyager 本来の色のままです。

- `--gv-theme-surface`（背景）、`--gv-theme-hover`（ホバーした行）、`--gv-theme-text`（文字）、`--gv-theme-text-muted`（補助的な文字、アイコン）、`--gv-theme-border`（枠線）: Voyager 自身のパネル、メニュー、ダイアログ、ツールチップ、トーストだけに効きます。Voyager がサイトのページに直接描く文字、枠線、ホバー色は、引き続きサイトに従います。
- `--gv-theme-accent`（ボタン、選択、フォーカス）、`--gv-theme-accent-fg`（アクセントカラー上の文字）、`--gv-theme-accent-hue`（アクセントカラーの OKLCH 色相。数値）、`--gv-theme-danger`（削除）: Voyager の UI とサイトのページの両方に効きます。
- `--gv-theme-timeline`: タイムラインのレール、選択されていないドットと目盛り、左側のスライダーのトラック。

Nord 配色の例:

```css
:root {
  --gv-theme-surface: #2e3440;
  --gv-theme-hover: #3b4252;
  --gv-theme-text: #eceff4;
  --gv-theme-text-muted: #d8dee9;
  --gv-theme-border: #4c566a;
  --gv-theme-accent: #88c0d0;
  --gv-theme-accent-fg: #2e3440;
  --gv-theme-danger: #bf616a;
  --gv-theme-timeline: #81a1c1;
}
```

## インポート時にチェックされるルール

共通のマニフェストチェック（[プラグイン貢献ガイド](./plugin-contribution.md)を参照）に加えて、ローカルプラグインは次の条件を満たす必要があります。

- Voyager が対応しているサイトの範囲内の URL にだけマッチすること
- マッチするすべてのサイトが宣言しているセマンティックキーだけを使うこと
- `addClass` 1 つにつきクラスは 1 つだけで、`gv-` で始まること
- 設定は boolean、number、select のいずれかであること（string と color にはまだポップアップの UI がありません）
- Gemini と AI Studio では `theme` を使わず、プリミティブは各サイトが許可するものだけを使うこと: Gemini では `formulaCopy`、`vimInput`、`userLatex`、`codeCollapse`、`mermaid`、`wavedrom`、`echarts`、`sendShortcut`、`draftSave`、`turnNavigator`、AI Studio では `formulaCopy`、`sendShortcut`。いずれも Voyager 標準の対応する設定と同じコードを実行する。`formulaCopy` と `vimInput`(数式コピー・入力欄 Vim モード)は、同じページで標準設定とプラグインのどちらか一方だけが動く。ページの読み込み時や、どちらも動いていないときは標準設定が優先され、その後はすでに動いている側がそのまま動き続け、もう一方は一時停止と表示される。どちらかをオフにすると、もう一方が引き継ぐ。`userLatex`、`codeCollapse`、`mermaid`、`wavedrom`、`echarts` は要素ごとに担当を取り合うため、標準設定と同時に動かせる: 相手がすでに処理している行やコードブロックには手を出さない

翻訳（`i18n`）は任意です。

### タイムライン、送信、下書きのプリミティブ

個人向けGeminiでは、`params.dataBackend: "shared"` と `engine: ">=1.9.0"` を指定すると、ローカルの `turnNavigator` を利用できます。公式タイムラインと同じネイティブのスター・階層データを読み書きし、会話・アカウント・ターンの識別パラメーターは上書きできません。公式の **タイムラインを表示** 設定とは競合するため、先に公式設定をオフにしてからローカルプラグインを有効にしてください。公式に戻すときは、先にローカルプラグインを無効にしてから公式設定をオンにします。Business、Enterprise、独自のサイト範囲には対応していません。

すべてのサイトで、送信ショートカットのプラグインはページごとに1つだけ動作します。送信モードを使用中のプラグインがある場合、もう一方は競合として一時停止します。任意の `mode`（`"engine": ">=1.9.0"` が必要）は `ctrlEnterSends`（既定）または `enterSends` です。IME の確定では送信しません。Gemini と AI Studio でも利用できます。対応モードは以下のとおりです。

Gemini では公式の Ctrl/Cmd+Enter 送信を `sendShortcut` で置き換えられます。公式設定をオフにしてからローカルプラグインを有効にしてください。`ctrlEnterSends` のみ対応し、Enterprise では動作しません。`composerRoot` は通常・編集入力欄を含み、`sendButton` は停止ボタンを除きます。

AI Studio の `sendShortcut` には `params.mode: "enterSends"` が必要です。公式の Enter 送信をオフにするとローカルプラグインに切り替えられます。Ctrl/Cmd+Enter は改行し、Shift/Alt+Enter はホストに任せます。

Gemini の `draftSave` は公式と同じ `gvDraft_<完全な pathname>` を使い、`/u/N` と Gem の経路を保持します。無効にしても保存済みの下書きは残り、同じページの複数プラグインで共有できます。終了前に最後の入力の保存を試みますが、ブラウザー終了時の非同期保存は保証できません。 書き込みと整理の調整は同じページ内に限られます。同じ `/u/N` スロットでメールアドレスを変更しても、保存済みの下書きを共有します。
