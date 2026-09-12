/**
 * Claude はまれに、複雑にネストしたtool useの入力を、期待される構造化オブジェクトの
 * 代わりに「JSON(相当)の文字列を1つのフィールドに詰め込んだ形」で返すことがある
 * （claude-sonnet-5, 2026-09時点の実機テストで複数回確認）。観測されたパターンは2つ:
 *
 * 1. 値がそのまま正しいJSON配列/オブジェクトとして文字列化されているケース。例:
 *      { topics: "[{...}]" }
 *
 * 2. 値の先頭にあるべき `{"<key>":` が欠落し、末尾の `}` だけが残った壊れたJSONに
 *    なっているケース。例えば本来 `{"topics":[...],"unclassifiedTweetIds":[...]}` を
 *    生成しようとしたはずが、`topics` というキー自体が先に消費され、値として
 *      "[{...},{...}],\"unclassifiedTweetIds\":[...]}"
 *    のような「配列は閉じているのに、その後ろに他のキーの中身と閉じ括弧が続く」
 *    壊れた文字列が入ってくる。これは先頭に `{"<key>":` を補って再パースすると
 *    元のオブジェクト全体として復元できる。
 *
 * この関数は上記のケースを検出し、可能な範囲で本来のオブジェクト構造に復元する。
 */
export function recoverStringifiedToolInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }
  const obj = input as Record<string, unknown>;
  const result: Record<string, unknown> = { ...obj };

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) continue;

    const parsed = tryParseJson(trimmed) ?? tryParseJson(`{"${key}":${trimmed}`);
    if (parsed === undefined) continue; // どちらの形でも解釈できなければ元の値のまま

    if (Array.isArray(parsed)) {
      result[key] = parsed;
    } else if (typeof parsed === "object" && parsed !== null) {
      // オブジェクト全体（他のキーも含む）がこのキーに詰め込まれていたケース。マージして復元する。
      Object.assign(result, parsed as Record<string, unknown>);
    }
  }

  return result;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
