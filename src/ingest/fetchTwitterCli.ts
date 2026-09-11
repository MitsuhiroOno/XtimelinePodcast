import { execFile } from "node:child_process";
import { promisify } from "node:util";
import YAML from "yaml";
import type { Tweet } from "../types.js";
import { extractTweetArray, normalizeTweet } from "./normalize.js";

const execFileAsync = promisify(execFile);

/** twitter-cli `feed --type` が受け付ける値（for-you: おすすめ, following: フォロー中の時系列順） */
export type TwitterCliFeedType = "for-you" | "following";

export interface FetchTwitterCliOptions {
  /** 取得件数の上限 */
  max?: number;
  /** フィード種別。省略時は twitter-cli 既定の "for-you"（おすすめ/アルゴリズム順） */
  timelineType?: TwitterCliFeedType;
  /** twitter-cli の実行ファイル名/パス（既定: 環境変数 TWITTER_CLI_BIN または "twitter"） */
  bin?: string;
}

interface ExecFileErrorLike {
  code?: number | string;
  stdout?: string;
  stderr?: string;
  message?: string;
}

function isExecFileErrorLike(err: unknown): err is ExecFileErrorLike {
  return typeof err === "object" && err !== null;
}

/**
 * twitter-cli (https://github.com/public-clis/twitter-cli, PyPI: `twitter-cli`) を
 * 子プロセスとして呼び出し、タイムラインを取得する。X/Twitter の公式APIキーは不要で、
 * twitter-cli 側がブラウザのCookie（または環境変数 TWITTER_AUTH_TOKEN / TWITTER_CT0）を
 * 使って認証する。
 *
 * 事前に `pip install twitter-cli`（または `uv tool install twitter-cli` /
 * `pipx install twitter-cli`）でインストールし、一度ブラウザにログインした状態で
 * このコマンドを実行できるようにしておく必要がある。
 */
export async function fetchTimelineViaTwitterCli(
  options: FetchTwitterCliOptions = {}
): Promise<Tweet[]> {
  const bin = options.bin ?? process.env.TWITTER_CLI_BIN ?? "twitter";
  const args = ["feed", "--json", "-t", options.timelineType ?? "for-you"];
  if (options.max) {
    args.push("--max", String(options.max));
  }

  let stdout: string;
  try {
    const result = await execFileAsync(bin, args, {
      maxBuffer: 1024 * 1024 * 64, // 64MB。大量ツイート取得時のバッファ不足を回避
    });
    stdout = result.stdout;
  } catch (err) {
    throw buildFetchError(bin, err);
  }

  const parsed = parseCliOutput(stdout);
  const rawTweets = extractTweetArray(parsed); // ok:false の場合はここで分かりやすい例外を投げる
  return rawTweets.map(normalizeTweet);
}

/**
 * twitter-cli はエラー時も終了コード1と共に `{ ok:false, error:{code,message} }` を
 * stdout に吐く実装になっているため、単なる「実行失敗」ではなくその中身を優先して伝える。
 */
function buildFetchError(bin: string, err: unknown): Error {
  if (isExecFileErrorLike(err) && err.stdout) {
    try {
      const parsed = parseCliOutput(err.stdout);
      // extractTweetArray は ok:false を見つけると具体的なメッセージ付きの例外を投げる
      extractTweetArray(parsed);
    } catch (parsedError) {
      if (parsedError instanceof Error) return parsedError;
    }
  }

  const stderr = isExecFileErrorLike(err) && err.stderr ? err.stderr.trim() : "";
  const original = err instanceof Error ? err.message : String(err);
  return new Error(
    `twitter-cli (${bin}) の実行に失敗しました。インストール済みか（pip install twitter-cli 等）、` +
      `ブラウザでXにログイン済みかを確認してください。\n` +
      (stderr ? `stderr: ${stderr}\n` : "") +
      `元のエラー: ${original}`
  );
}

function parseCliOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // 非TTY実行でも --json を明示しているため通常はJSONになるはずだが、
    // 念のためYAMLへのフォールバックも用意しておく
    return YAML.parse(trimmed);
  }
}
