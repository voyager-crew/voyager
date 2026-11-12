# プラグイン貢献ガイド

Voyager のプラグインシステムは、宣言的なプラグインを優先します。`plugin.json` でプラグイン情報と DOM 操作を記述し、CSS で見た目を調整します。プラグイン自体はリモート JavaScript を実行せず、Voyager 内蔵のプラグインエンジンがマニフェストとスタイルを解釈します。

これにより、プラグインのレビューと保守がしやすくなります。プラグインを貢献したい場合は、まずこの方式から始めてください。

## 自分だけで使う場合: ローカルプラグイン

自分のブラウザだけで使うプラグインであれば、この手順は必要ありません。ローカルプラグインとして作成し、ポップアップからインポートしてください。Issue も PR もリポジトリのチェックアウトも不要です。いちばん手早いのは [作成モード](./create-mode.md) で、一文書けばサイトの AI がプラグインを書きます。コーディングエージェントに任せたいときや手で書きたいときは、[自分でプラグインを作る](./write-a-plugin.md) を見てください。`create-voyager-plugin` のチェッカーと、コーディングエージェント向けのスキルも含まれます。

## 推奨フロー

1. そのアイデアがプラグイン向きか確認します。読み取り幅、レイアウト修正、テーマ調整、ページ要素の非表示やマーク、簡単なサイト適配はよい候補です。
2. Voyager 本体リポジトリで先に Issue を作成し、解決する問題、対象サイト、既存プラグインとの差分を説明します。メンテナーの明示的な承認を待ってから実装と PR 作成を始めてください。
3. `plugin.json` にメタデータ、対象サイト、設定、貢献内容を書きます。
4. スタイルは同じディレクトリの `style.css` に置き、`contributes.styles` から参照します。
5. ローカルでテストし、PR にテストページ、スクリーンショット、または短い録画を添えてください。公式 catalog に入れるかどうかは成熟度を見て判断します。

## ディレクトリ構成

公式のバンドルプラグインは `src/features/plugins/catalog/` の下にあり、プラグイン対応サイトごとに 1 ディレクトリです。

```
src/features/plugins/catalog/
  marketplace.json                        手で管理するサイトプラグインの索引（テストで検証）
  sites/<site>/site.json                  データとしてのサイトアダプタ
  sites/<site>/plugins/<id>/plugin.json   宣言的プラグイン
  sites/<site>/plugins/<id>/style.css     そのスタイル
  sites/<site>/plugins/<id>/README.md     何をどう直すかの説明
```

検出は自動です。`catalog/sites/index.ts` が `import.meta.glob` で各 `site.json` と各 `plugin.json` を見つけるため、サイトやプラグインの追加はファイルの追加だけで済み、書き換えるべき対応表はありません。

`marketplace.json` はその対応表ではなく、手で管理しているサイトプラグインの索引です。テストが検出結果との一致を保証しているので、新しいプラグインはここにも 1 件追加します（`bun run plugin:new` が追記してくれます）。`source` は catalog からの相対パスで、たとえば `sites/deepseek/plugins/reading-width/plugin.json` です。ただし `sites/gemini/` と `sites/aistudio/` の下のプラグインは例外で、Voyager に同梱されるため `marketplace.json` には載せません。ドキュメントの [プラグイン一覧](/ja/guide/plugins) はこのファイルではなく、ディスク上の各マニフェストを直接読みます。

プラグインの `matches` は、それが置かれているサイトの `matches` の内側に収まっていなければなりません。はみ出したプラグインはビルドを失敗させます。

## 意味的セレクタキー

`site.json` は固定語彙の意味的キーをサイト固有の CSS セレクタに対応づけます。語彙は `src/features/plugins/sites/semanticKeys.ts` で定義されており、`site.json` はこのリストのキーしか使えません。未知のキーは拒否されます。

- `userTurn`: ユーザーメッセージのコンテナ。
- `assistantTurn`: アシスタントメッセージのコンテナ。
- `thinkingBlock`: アシスタント応答内の思考部分。
- `codeBlock`: 描画済みのコードブロック。
- `composer`: ユーザーが入力するプロンプト欄。
- `sidebar`: 会話一覧またはナビゲーションレール。
- `sidePanel`: artifacts や canvas などの副次パネル。
- `headerActions`: 会話画面右上の操作エリア。
- `scrollContainer`: 会話をスクロールさせる要素。
- `composerRoot`: プロンプト欄とその操作ボタンをまとめたコンテナ。
- `sendButton`: プロンプトを送信するボタン。入力があるときだけ表示されるサイトもあります。

サイトは実際に提供できるキーだけを宣言します。プラグインはセレクタを直接書かず、DOM 操作の `target` に `{ "kind": "semantic", "key": "userTurn" }` と書いてキーを参照するので、サイトの改修は `site.json` 1 ファイルの修正で済みます。

`conversationIdPattern` はセレクタではなく `site.json` の別フィールドです。URL パスに対する正規表現で、最初のキャプチャグループが会話 ID になります。たとえば `^/chat/([^/?#]+)` です。

[新しいプラットフォームを追加する](./adding-a-platform.md)

## プラグインの粒度

プラグインは「ユーザーが解決したい問題」で区切るべきで、プラットフォームごとに機械的に分割する必要はありません。

カタログのプラグインは 1 つのサイトフォルダに置かれ、すべての `matches` はそのフォルダの `site.json` の範囲内でなければなりません（超えると `bun run plugin:check` が失敗します）。そのため 1 つのプラグインで Claude と ChatGPT の両方をカバーすることはできません。読み取り幅、ページ送り、コードブロックのレイアウトのように複数のプラットフォームに合う機能は、サイトフォルダごとに 1 つずつプラグインを作り（例：`sites/claude/plugins/reading-width` と `sites/chatgpt/plugins/reading-width`）、名前・設定・説明をそろえてください。

一方、プラットフォームごとに設定、DOM ロジック、ユーザー向け文言が大きく違う場合は、分けたほうが明確です。「全部入り」にするために無関係な機能を詰め込まないでください。1 つのプラグインは 1 つの明確な問題を解くのが理想です。

簡単な判断基準：

- 同じユーザー目標、同じ設定、違うのはセレクタだけ：サイトフォルダごとに 1 つずつ作り、名前と設定をそろえる。
- 同じテーマだが各プラットフォームの体験が大きく違う：分割してもよいが、名前と説明に関連性を持たせる。
- 機能目標が違う：統合しない。

## 重複プラグインを避ける

提出前に [プラグイン一覧](/ja/guide/plugins) で既存の公式プラグインを確認してください。すでによいプラグインがある場合は、似たものを新しく作るより、そのプラグインを改善する PR を優先してください。

重複プラグインが受け入れられるのは、次のような明確な改善がある場合です。

- 既存プラグインが対応していない重要なプラットフォームをサポートする。
- 既存プラグインで長く解決できていない互換性問題を修正する。
- パフォーマンス、アクセシビリティ、保守性が明確に向上している。
- 名前や細かなスタイル変更だけではなく、十分に異なる有用な体験を提供する。

これによりプラグイン一覧が整理され、ユーザーも選びやすくなります。

## 最小例

空のディレクトリから始める必要はありません。`bun run plugin:new <id-segment> --site <site>` を実行すると `catalog/sites/<site>/plugins/<id-segment>/` が作られ、`plugin.json`、`style.css`、`README.md` が入り、`marketplace.json` にも対応するエントリが追記されます。生成されるのは出発点であって承認ではありません。埋めていくマニフェストはこの形です。

```json
{
  "$schema": "https://voyager.nagi.fun/plugin.schema.json",
  "id": "your-name.example-plugin",
  "name": "Example Plugin",
  "version": "1.0.0",
  "description": "A short description of what this plugin improves.",
  "author": "your-name",
  "category": "readability",
  "license": "MIT",
  "engine": ">=1.0.0",
  "tier": "declarative",
  "matches": ["https://claude.ai/*"],
  "contributes": {
    "styles": [{ "file": "style.css" }],
    "domOps": [
      {
        "op": "addClass",
        "target": "body",
        "className": "gv-plugin-example"
      }
    ]
  }
}
```

`$schema` の行は任意で、エディタのためだけのものです。マニフェストの JSON Schema を指すので、書きながら検証と補完が効きます。`site.json` 用は `https://voyager.nagi.fun/site.schema.json` にあります。

`style.css` は通常の CSS として書けますが、プラグインのスタイルは自分の `gv-plugin-*` クラス配下に閉じることを推奨します。

```css
.gv-plugin-example .some-target {
  max-width: 880px;
}
```

## Manifest の注意点

- `id` は `your-name.reading-width` のように、作者プレフィックスまたは逆ドメイン風の名前にして衝突を避けます。
- `matches` はできるだけ狭くし、本当に必要なサイトだけに一致させます。
- `matches` に複数のホストを書けるのは、そのサイトの `site.json` がすべてをカバーしている場合だけです（例：chatgpt.com と chat.openai.com）。別のサイトに対応するには、そのサイトのフォルダにプラグインを追加してください。
- `category` は `render-fix`、`theme`、`layout`、`readability`、`productivity`、`integration`、`other` を推奨します。
- プラグインに必要な最低限の Voyager バージョンを `engine` に明記します。公式プラグインを参考にできます。
- `i18n` には中国語、英語、その他よく使われる言語の名前、説明、設定文言をできるだけ追加してください。

## CSS とリソース制限

宣言的プラグインは信頼されていない入力として検証されるため、リソースは自己完結にしてください。

- `@import` を使わない。
- リモート画像、外部フォント、リモート CSS を参照しない。
- 通常の CSS、カスタムプロパティ、Voyager が提供する設定値の置換は使用できます。
- クラス名には `gv-plugin-` プレフィックスを使い、ホストサイトや Voyager 本体のスタイルを汚染しないようにします。

設定が必要な場合は、まず数値設定から始めるのがおすすめです。たとえば読み取り幅プラグインは、設定値を CSS 変数に書き込み、その変数を CSS 側で使えます。

[DOM 操作の範囲](./dom-operation-boundaries.md)

## 通常プラグインに向かない場合

JavaScript の実行、リクエストの遮断、Voyager 内部データの読み書き、複雑な実行時ロジックが必要な機能は、通常の宣言的プラグインには向きません。

その場合はまず Issue を開いて要件を説明してください。本当に内蔵能力が必要な場合は、Formula Copy のような builtin/native プラグインとして Voyager 本体に実装することを検討します。

## PR 前チェック

`bun run plugin:check <プラグインディレクトリ>` を実行し、その出力を PR に貼ってください。マニフェストと CSS、`matches` がサイトの範囲を超えていないか、プリミティブ、意味的セレクタキー、10 言語の翻訳、README まで、問題を一度にすべて報告します。CI も同じチェックをすべての内蔵プラグインに対して実行します。

- プラグインはデフォルトで無効で、ユーザーが自分で有効化する。
- ほぼ同じ既存プラグインがないか確認した。ある場合は既存プラグインの改善を優先した。
- 対象サイトのライトテーマとダークテーマでテストした。
- `matches` が無関係なサイトを含んでいない。
- リモートリソースを参照していない。
- プラグインディレクトリに `plugin.json`、必要な CSS ファイル、短い README がある。
- 公式プラグインなら、ディレクトリが `catalog/sites/<site>/plugins/<id>/` にあり、`matches` がサイトの `matches` の内側で、`catalog/marketplace.json` に登録されている（Gemini と AI Studio のプラグインは Voyager に同梱されるため除く）。
- PR でテストページ、スクリーンショットまたは録画、影響を受けるページ領域を説明している。

シンプルで、控えめで、取り消し可能にしてください。1 つの明確な問題を解くプラグインほど、マージと保守がしやすくなります。
