# XtimelinePodcast

X (Twitter) のタイムラインを取得・整理し、[NotebookLM](https://notebooklm.google/) の
Audio Overview のように、2人のAIホストが会話形式で解説する**ポッドキャスト台本**を
生成する CLI ツールです。

**会話スクリプト（テキスト）の生成**に加えて、OpenAI TTS による**音声化（mp3）**にも対応しています。

## 全体の仕組み

```
[1] タイムライン取得        [2] 整理（トピック化）          [3] 台本生成            [4] 音声化
twitter-cli --json    →    Claude: ツイートを話題ごとに  →  Claude: 2人のAIホストの → OpenAI TTS:
(ブラウザCookie認証)        グルーピング・要約・重要度付け      自然な会話に変換          ホストごとに
                                                              ↓                         別の声で読み上げ
                                                        podcast.md（台本）         → podcast.mp3
```

1. **取得**: [twitter-cli](https://github.com/public-clis/twitter-cli) を子プロセスとして呼び出し、
   X の公式APIキーなしに（ブラウザのログインCookieを利用して）タイムラインを取得します。
   すでに `twitter feed --json` 等で保存したファイルを直接読み込むこともできます。
2. **整理**: 取得したツイート群を Claude (Anthropic API) に渡し、話題ごとにグルーピング・要約・
   重要度付けを行います（広告やノイズは自動的に未分類として除外）。
3. **台本生成**: 整理済みのトピックをもとに、Claude が2人のホストによる自然な掛け合い形式の
   ポッドキャスト台本（イントロ〜本編〜アウトロ）を生成します。
4. **音声化（任意）**: OpenAI TTS で各ターンをホストごとに別の声で読み上げ、1本のmp3に結合します。

## セットアップ

```bash
npm install
cp .env.example .env
# .env を編集して ANTHROPIC_API_KEY を設定
# 音声化も使う場合は OPENAI_API_KEY も設定
```

### twitter-cli の準備（タイムラインを直接取得する場合）

```bash
pip install twitter-cli   # または: uv tool install twitter-cli / pipx install twitter-cli
```

初回はブラウザ（Chrome/Edge/Firefox/Brave/Arc等）でXにログインした状態にしておくと、
twitter-cli がそのCookieを自動抽出して認証します（`TWITTER_AUTH_TOKEN` / `TWITTER_CT0`
環境変数での認証も可能）。認証状態は `twitter status` で確認できます。詳細は
twitter-cli 本体のドキュメントを参照してください。

`twitter feed -t for-you|following --max N --json` のように、フィードは
「for-you（おすすめ・アルゴリズム順）」と「following（フォロー中・時系列順）」の
2種類から選べます。本ツールの `--following` フラグはこの `following` に対応し、
省略時は `for-you` を取得します。

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

### D. 音声化する（ポッドキャストとして聴く）

台本生成と同時に音声化する場合:

```bash
npm run dev -- generate --input tweets.json --output podcast.md --audio podcast.mp3
```

すでにある台本JSONから音声だけ作る場合:

```bash
# 台本生成時に --json-output で構造化データを保存しておく
npm run dev -- generate --input tweets.json --json-output script.json

# その台本を音声化
npm run dev -- speak --input script.json --output podcast.mp3 --voices nova,onyx
```

ホストごとに別の声が自動で割り当てられます（`--voices` で明示指定も可能）。
OpenAI TTS で使える声: `nova` / `onyx` / `shimmer` / `echo` / `alloy` / `fable` /
`ballad` / `coral` / `sage` / `verse`。

### 主なオプション（`generate` / `run` 共通）

| オプション | 説明 | デフォルト |
| --- | --- | --- |
| `--hosts "アヤ,ケン"` | ホスト2名の名前（カンマ区切り） | `アヤ,ケン` |
| `--language ja` | 台本の言語 | `ja` |
| `--turns 40` | 台本のおおよそのターン数の目安 | `40` |
| `--model claude-opus-5` | 使用するモデル名 | `ANTHROPIC_MODEL` または `claude-sonnet-5` |
| `--style "もっとテンポよく、笑いを交えて"` | トーンに関する追加指示 | なし |
| `--json-output script.json` | 発話ターンなどの構造化データも保存 | なし |
| `--exclude-retweets` | リツイート/リポストを整理対象から除外 | 除外しない |
| `--exclude-replies` | リプライを整理対象から除外 | 除外しない |
| `--max-tweets 300` | トピック整理に渡すツイート数の上限 | `300` |
| `--audio podcast.mp3` | 台本をTTSで音声化してmp3保存（`OPENAI_API_KEY`が必要） | 音声化しない |
| `--voices nova,onyx` | ホスト順の声を指定 | 既定の声を順に自動割り当て |
| `--tts-model gpt-4o-mini-tts` | TTSモデル名 | `OPENAI_TTS_MODEL` または `gpt-4o-mini-tts` |
| `--speed 1.1` | 読み上げ速度（0.25〜4.0） | API既定値 |
| `--concurrency 3` | 音声合成の同時リクエスト数 | `3` |

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
    filterTweets.ts          # RT/リプライ等の除外フィルタ
  llm/
    client.ts                # Anthropic SDKクライアント
    organizeTopics.ts        # ツイート→トピック整理（tool use）
    generateDialogue.ts      # トピック→会話台本生成（tool use）
  llm/
    recoverToolInput.ts      # tool use入力が文字列化された場合の復元（実機バグ対策）
  render/
    renderTranscript.ts      # PodcastScript → Markdown/JSON
    loadScript.ts            # 台本JSONの読み込み（音声化の入力）
  tts/
    types.ts                 # TtsProvider 抽象（プロバイダ差し替え可能）
    openai.ts                # OpenAI TTS 実装（リトライ付き）
    synthesizeScript.ts      # 台本→音声。話者ごとの声割り当て・並列合成
    concat.ts                # ID3タグを除去してmp3を結合（ffmpeg不要）
  cli.ts                     # commander によるCLIエントリポイント
  index.ts                   # プログラムから使う場合の高レベルAPI (runPipeline)
```

## 注意事項

- twitter-cli はブラウザのログインCookieを利用してX/Twitterへアクセスします。**自分自身のアカウント**での
  個人利用を前提としており、Xの利用規約に従って利用してください。大量アカウントへの一括アクセスや、
  他者のログイン情報の無断利用などには使用しないでください。
- twitter-cli (PyPI版 0.8.5) のソースコードを確認し、実際の出力スキーマ
  （`{ ok, schema_version, data: [{ id, text, author: { name, screenName, ... },
  metrics: { likes, retweets, replies, ... }, createdAt, createdAtISO, isRetweet,
  quotedTweet, articleTitle, articleText, ... } ] }`）に合わせて `normalize.ts` を
  調整済みです。将来的なツール側のバージョンアップでフィールド名が変わった場合や、
  類似の別ツールを使う場合に備えて、よくある別名（snake_case版等）も幅広く吸収する
  作りにしています。想定外の形式で正しく取得できない場合は
  `src/ingest/normalize.ts` の `pick*` / `firstNonEmptyString` 系ヘルパーに
  候補キーを追加してください。
- 生成される台本はあくまで「Xでこういう投稿が話題になっている」という紹介であり、事実の断定的な
  解説ではありません（プロンプト内でもその旨を指示しています）。
- 音声の結合は外部ツール（ffmpeg等）に依存せず、各mp3からID3タグを除去した上で
  MPEGフレーム列として連結しています。同一モデル・同一フォーマットで生成したmp3同士なら
  この方法で問題なく通しで再生できます。
- TTSは読み上げた文字数で課金されるため、長い台本を音声化する際はご注意ください
  （実行後に読み上げ文字数がログに表示されます）。
