import { readFile } from "node:fs/promises";
import type { PodcastScript } from "../types.js";

/**
 * `generate --json-output` で保存した台本JSONを読み込む。
 * 音声合成（speak コマンド）の入力として使う。
 */
export async function loadScriptFromJson(filePath: string): Promise<PodcastScript> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `台本JSONのパースに失敗しました (${filePath}): ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`台本JSONの形式が不正です (${filePath}): オブジェクトではありません。`);
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.turns)) {
    throw new Error(
      `台本JSONの形式が不正です (${filePath}): turns 配列が見つかりません。` +
        `generate コマンドの --json-output で出力したファイルを指定してください。`
    );
  }

  const turns = obj.turns
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .map((t) => ({
      speaker: typeof t.speaker === "string" ? t.speaker : "",
      text: typeof t.text === "string" ? t.text : "",
    }))
    .filter((t) => t.text.trim().length > 0);

  const hosts = Array.isArray(obj.hosts)
    ? obj.hosts.filter((h): h is string => typeof h === "string")
    : // hosts が無い場合はターンの話者から復元する
      [...new Set(turns.map((t) => t.speaker).filter(Boolean))];

  return {
    title: typeof obj.title === "string" ? obj.title : "無題のエピソード",
    description: typeof obj.description === "string" ? obj.description : "",
    hosts,
    turns,
    topics: Array.isArray(obj.topics) ? (obj.topics as PodcastScript["topics"]) : [],
  };
}
