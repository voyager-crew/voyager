# ✨ 主な機能

## 🌌 共通コア (Gemini & AI Studio)

- **📂 [フォルダ管理](https://voyager.nagi.fun/ja/guide/folders)**: 最大 3 階層のフォルダ構造で、ドラッグ＆ドロップによりチャットを整理できます。
  - **Gemini**: **マルチアカウント分離モード**と**カスタムフォルダカラー**をサポート。
- **💡 [プロンプト管理](https://voyager.nagi.fun/ja/guide/prompts)**: プロンプトを保存して再利用。Gemini、AI Studio、[カスタムサイト](https://voyager.nagi.fun/ja/guide/prompts#あらゆるサイトで利用可能)で使用可能。
- **☁️ [クラウド同期](https://voyager.nagi.fun/ja/guide/cloud-sync)**: Google ドライブ、または Safari では iCloud を通じて、フォルダとプロンプトを同期できます。
- **🗑️ [一括削除](https://voyager.nagi.fun/ja/guide/batch-delete)**: 会話をまとめて削除できます。
- **📐 [数式コピー](https://voyager.nagi.fun/ja/guide/formula-copy)**: 数式をクリックすると、LaTeX、MathML（Word）、または Notion で使える数式としてコピーできます。

## ✨ Gemini 専用機能

- **📍 [タイムライン](https://voyager.nagi.fun/ja/guide/timeline)**: 会話構造を可視化し、メッセージ間を瞬時に移動。重要なメッセージのスター保存も可能。
- **💾 [エクスポート](https://voyager.nagi.fun/ja/guide/export)**: 会話を JSON、Markdown、PDF、または画像で書き出せます。画像も含まれます。
- **🧜‍♀️ [Mermaid レンダリング](https://voyager.nagi.fun/ja/guide/mermaid)**: フローチャート、シーケンス図、その他の Mermaid チャートを自動レンダリングします。
- **📝 [Markdown レンダリングの修正](https://voyager.nagi.fun/ja/guide/markdown-fix)**: Gemini が挿入した HTML 要素によって壊れた Markdown の太字構文を自動的に修正します。
- **🍌 [Image Refinement](https://voyager.nagi.fun/ja/guide/nanobanana)**: Gemini で生成された画像からウォーターマークを自動除去。
- **🔬 [Deep Research](https://voyager.nagi.fun/ja/guide/deep-research)**: 思考プロセスやリサーチリンクを Markdown で抽出。
- **🛠️ パワーツール**:
  - **[引用返信](https://voyager.nagi.fun/ja/guide/quote-reply)**: テキストを選択してワンクリックで引用。
  - **[自動スクロール防止](https://voyager.nagi.fun/ja/guide/prevent-auto-scroll)**: 新しいプロンプトを送信する際の迷惑なジャンプ動作を阻止します。
  - **[入力欄の自動非表示](https://voyager.nagi.fun/ja/guide/input-collapse)**: 未入力時に折りたたんで表示スペースを確保。
  - **[デフォルトモデル](https://voyager.nagi.fun/ja/guide/default-model)**: 新しい対話に使用するデフォルトのモデルを設定します。

## 🔌 Claude, ChatGPT, DeepSeek & Kimi

[Voyager プラグインエンジン](https://voyager.nagi.fun/ja/guide/plugins)を基盤に、これらの機能で Gemini の外でも体験を広げます。拡張機能のポップアップでオンにし、各サイトへのアクセスを許可してください。

- **📍 タイムライン**: ChatGPT、Claude、DeepSeek で、スター付きメッセージと検索を備えた同じタイムラインが使えます。オンにするまではオフです。
- **📂 フォルダ**: ChatGPT、Claude、DeepSeek、Kimi で会話をフォルダに整理できます。ChatGPT のフォルダは既定でオンです。
- **💾 エクスポート**: ChatGPT、Claude、DeepSeek、Kimi で会話を Markdown、JSON、PDF、または画像で書き出せます。
- **📐 数式コピー**: Claude、ChatGPT、DeepSeek で、数式をクリックすると LaTeX をコピーできます。
- **⌨️ Vim 入力**: Claude、ChatGPT、DeepSeek の入力欄で、Vim 風のモード編集とカーソル移動ができます。
- **📖 快適な閲覧幅**: Claude、ChatGPT、DeepSeek、Kimi のチャット幅を調整し、より良い読書体験を。
- **💬 日常の便利機能**: Claude、ChatGPT、DeepSeek、Kimi で、引用返信、Ctrl/⌘+Enter での送信、下書きの文字数カウントが使えます。Claude、DeepSeek、Kimi では、下書きの自動保存にも対応しています。
- **🈶 CJK レンダリング修正**: Claude での日中韓文字のレンダリング問題を修正。
- **📜 コード折り返しなし**: DeepSeek では長いコード行を折り返さず横スクロールにし、インデントを保持。

## 🧩 どんなサイトでも — localhost も

ポップアップでサイトを追加すれば、Prompt Manager はそこにも付いてきます。ローカルアプリも同様です。下は `localhost:3080` で動く [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) の中での様子です：

<p align="center">
  <img src="../../../docs/public/assets/prompt-manager-deepseek-harness.png" alt="DeepSeek Harness 内で動作する Prompt Manager" width="720">
</p>

## 🎨 パーソナライズ

- **🌦️ ビジュアルエフェクト**: **雪**、**映画的な雨**、**桜の花びら**で、Voyager が動作するすべてのサイトに季節の雰囲気を演出。
- Gemini と AI Studio では、拡張機能のポップアップで **ページレイアウト** → **視覚効果** をオンにして、その行の下で `雪`、`桜`、`雨` から選びます。オフにするとエフェクトも止まります。Claude、ChatGPT、DeepSeek、カスタムサイトでは、同じ行がそのサイトの **プラグイン** カードにあります。
- エフェクトは軽量なフルスクリーンオーバーレイとしてレンダリングされ、ページの操作を妨げません。
- エフェクトを切り替えたりオフにしたりすると、パーティクルは突然消えるのではなく、自然にフェードアウトします。
