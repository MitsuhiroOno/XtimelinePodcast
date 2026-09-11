# XtimelinePodcast

X (Twitter) のタイムラインを取得・整理し、[NotebookLM](https://notebooklm.google/) の
Audio Overview のように、2人のAIホストが会話形式で解説する**ポッドキャスト台本**を
生成する CLI ツールです。

現バージョンでは音声合成は行わず、**会話スクリプト（テキスト）** を生成するところまでを実装しています。

## 全体の仕組み

```
[1] タイムライン取得        [2] 整理（トピック化）          [3] 台本生成
twitter-cli --json    →    Claude: ツイートを話題ごとに  →  Claude: 2人のAIホストの
(ブラウザCookie認証)        グルーピング・要約・重要度付け      自然な会話に変換
                                                              ↓
                                                        podcast.md（Markdown台本）
```

1. **取得**: [twitter-cli](https://github.com/public-clis/twitter-cli) を子プロセスとして呼び出し、
   X の公式APIキーなしに（ブラウザのログインCookieを利用して）タイムラインを取得します。
   すでに `twitter feed --json` 等で保存したファイルを直接読み込むこともできます。
2. **整理**: 取得したツイート群を Claude (Anthropic API) に渡し、話題ごとにグルーピング・要約・
   重要度付けを行います（広告やノイズは自動的に未分類として除外）。
3. **台本生成**: 整理済みのトピックをもとに、Claude が2人のホストによる自然な掛け合い形式の
   ポッドキャスト台本（イントロ〜本編〜アウトロ）を生成します。

## セットアップ

```bash
npm install
cp .env.example .env
# .env を編集して ANTHROPIC_API_KEY を設定
```

### twitter-cli の準備（タイムラインを直接取得する場合）

```bash
uv tool install twitter-cli   # または: pipx install twitter-cli
```

初回はブラウザ（Chrome/Edge/Firefox/Brave/Arc等）でXにログインした状態にしておくと、
twitter-cli がそのCookieを自動抽出して認証します（`TWITTER_AUTH_TOKEN` / `TWITTER_CT0`
環境変数での認証も可能）。詳細は twitter-cli 本体のドキュメントを参照してください。

手元に別途エクスポート済みの `twitter feed --json` 出力がある場合は、twitter-cli自体の
インストールは不要で、`generate` コマンドにそのファイルを渡すだけで使えます。

## 使い方

### A. まとめて実行（取得 → 整理 → 台本生成）

```bash
npm run dev -- run --max 100 --output podcast.md
```

### B. 取得と生成を分けて実行

```bash
# 1. タイムラインを取得してJSON保存
npm run dev -- fetch --max 100 --output tweets.json

# 2. 保存したJSONから台本を生成
npm run dev -- generate --input tweets.json --output podcast.md
```

### C. すでに手元にある twitter-cli の出力ファイルから生成

```bash
npm run dev -- generate --input path/to/exported-timeline.json --output podcast.md
```

JSON・YAML（`.json` / `.yaml` / `.yml`）どちらの拡張子にも対応しています。
サンプル入力は [`examples/sample-tweets.json`](./examples/sample-tweets.json) を参照してください。

```bash
npm run dev -- generate --input examples/sample-tweets.json --output /tmp/podcast.md
```

### 主なオプション（`generate` / `run` 共通）

| オプション | 説明 | デフォルト |
| --- | --- | --- |
| `--hosts "アヤ,ケン"` | ホスト2名の名前（カンマ区切り） | `アヤ,ケン` |
| `--language ja` | 台本の言語 | `ja` |
| `--turns 40` | 台本のおおよそのターン数の目安 | `40` |
| `--model claude-opus-5` | 使用するモデル名 | `ANTHROPIC_MODEL` または `claude-sonnet-5` |
| `--style "もっとテンポよく、笑いを交えて"` | トーンに関する追加指示 | なし |
| `--json-output script.json` | 発話ターンなどの構造化データも保存 | なし |

ビルド後は `xtimeline-podcast` コマンドとしても実行できます（`npm run build` 後、`npm link` 等で）。

## 開発

```bash
npm run dev -- --help    # tsx でTypeScriptを直接実行
npm run typecheck        # 型チェックのみ
npm test                 # node:test でユニットテスト実行
npm run build             # dist/ にコンパイル
```

## プロジェクト構成

```
src/
  types.ts                 # Tweet / Topic / PodcastScript などの内部型
  ingest/
    normalize.ts            # twitter-cli等のスキーマ揺らぎを吸収する正規化層
    loadFromFile.ts          # JSON/YAMLファイルからの読み込み
    fetchTwitterCli.ts       # twitter-cliをサブプロセスとして呼び出す
  llm/
    client.ts                # Anthropic SDKクライアント
    organizeTopics.ts        # ツイート→トピック整理（tool use）
    generateDialogue.ts      # トピック→会話台本生成（tool use）
  render/
    renderTranscript.ts      # PodcastScript → Markdown/JSON
  cli.ts                     # commander によるCLIエントリポイント
  index.ts                   # プログラムから使う場合の高レベルAPI (runPipeline)
```

## 注意事項

- twitter-cli はブラウザのログインCookieを利用してX/Twitterへアクセスします。**自分自身のアカウント**での
  個人利用を前提としており、Xの利用規約に従って利用してください。大量アカウントへの一括アクセスや、
  他者のログイン情報の無断利用などには使用しないでください。
- twitter-cli の出力スキーマはツール側のバージョンにより変わる可能性があります。`normalize.ts` は
  よくあるフィールド名（`text`/`full_text`、`author.username`/`user.screen_name` 等）を
  幅広く吸収するように書かれていますが、想定外の形式で正しく取得できない場合は
  `src/ingest/normalize.ts` の `pick*` 系ヘルパーに候補キーを追加してください。
- 生成される台本はあくまで「Xでこういう投稿が話題になっている」という紹介であり、事実の断定的な
  解説ではありません（プロンプト内でもその旨を指示しています）。
