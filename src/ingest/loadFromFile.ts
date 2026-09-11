import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import YAML from "yaml";
import type { Tweet } from "../types.js";
import { normalizeTimeline } from "./normalize.js";

/**
 * twitter-cli の `--json` / `--yaml` 出力を保存したファイル（または標準入力からの
 * 保存結果）を読み込み、内部の Tweet[] へ正規化する。
 *
 * 例:
 *   twitter feed --json --max 100 -o tweets.json
 *   xtimeline-podcast generate --input tweets.json
 */
export async function loadTweetsFromFile(filePath: string): Promise<Tweet[]> {
  const content = await readFile(filePath, "utf8");
  const parsed = parseByExtension(content, extname(filePath).toLowerCase());
  return normalizeTimeline(parsed);
}

function parseByExtension(content: string, ext: string): unknown {
  if (ext === ".yaml" || ext === ".yml") {
    return YAML.parse(content);
  }
  if (ext === ".json") {
    return JSON.parse(content);
  }
  // 拡張子が不明な場合はまず JSON として、失敗したら YAML としてパースを試みる
  // （twitter-cli は非TTY実行時デフォルトで YAML を出力するため）
  try {
    return JSON.parse(content);
  } catch {
    return YAML.parse(content);
  }
}
