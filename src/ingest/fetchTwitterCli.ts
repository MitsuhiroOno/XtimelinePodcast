import { execFile } from "node:child_process";
import { promisify } from "node:util";
import YAML from "yaml";
import type { Tweet } from "../types.js";
import { normalizeTimeline } from "./normalize.js";

const execFileAsync = promisify(execFile);

export interface FetchTwitterCliOptions {
  /** 取得件数の上限 */
  max?: number;
  /** "following" を指定するとフォロー中タイムライン、省略時はホームタイムライン */
  timelineType?: "home" | "following";
  /** twitter-cli の実行ファイル名/パス（既定: 環境変数 TWITTER_CLI_BIN または "twitter"） */
  bin?: string;
}

/**
 * twitter-cli (https://github.com/public-clis/twitter-cli) を子プロセスとして呼び出し、
 * タイムラインを取得する。X/Twitter の公式APIキーは不要で、twitter-cli 側が
 * ブラウザのCookie（または環境変数 TWITTER_AUTH_TOKEN / TWITTER_CT0）を使って認証する。
 *
 * 事前に `uv tool install twitter-cli` または `pipx install twitter-cli` でインストールし、
 * 一度ブラウザにログインした状態でこのコマンドを実行できるようにしておく必要がある。
 */
export async function fetchTimelineViaTwitterCli(
  options: FetchTwitterCliOptions = {}
): Promise<Tweet[]> {
  const bin = options.bin ?? process.env.TWITTER_CLI_BIN ?? "twitter";
  const args = ["feed", "--json"];
  if (options.max) {
    args.push("--max", String(options.max));
  }
  if (options.timelineType === "following") {
    args.push("-t", "following");
  }

  let stdout: string;
  try {
    const result = await execFileAsync(bin, args, {
      maxBuffer: 1024 * 1024 * 64, // 64MB。大量ツイート取得時のバッファ不足を回避
    });
    stdout = result.stdout;
  } catch (err) {
    throw new Error(
      `twitter-cli (${bin}) の実行に失敗しました。インストール済みか（uv tool install twitter-cli / ` +
        `pipx install twitter-cli）、ブラウザでXにログイン済みかを確認してください。\n` +
        `元のエラー: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const parsed = parseCliOutput(stdout);
  return normalizeTimeline(parsed);
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
