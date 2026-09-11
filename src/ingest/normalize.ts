import type { Tweet } from "../types.js";

/**
 * twitter-cli (https://github.com/public-clis/twitter-cli) の JSON/YAML 出力は
 * `{ ok, schema_version, data, pagination }` のようなエンベロープを持つことがあり、
 * `data` は配列そのものだったり `{ tweets: [...] }` のように入れ子になっていたりする。
 * バージョンやコマンド（feed / bookmarks / search 等）によってフィールド名も
 * 揺らぎ得るため、ここでは特定のスキーマに固定せず緩やかに正規化する。
 */

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 与えられたオブジェクトから、候補キー名を順番に探して最初に見つかった値を返す */
function pick(obj: Json, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return undefined;
}

function pickString(obj: Json, keys: string[]): string | undefined {
  const v = pick(obj, keys);
  return typeof v === "string" ? v : undefined;
}

function pickNumber(obj: Json, keys: string[]): number | undefined {
  const v = pick(obj, keys);
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

function pickBoolean(obj: Json, keys: string[]): boolean | undefined {
  const v = pick(obj, keys);
  if (typeof v === "boolean") return v;
  return undefined;
}

/**
 * ルートとなる parsed JSON/YAML から、ツイートらしきオブジェクトの配列を探し出す。
 * `data` / `tweets` / `items` / `results` などのよくあるラッパーキーを順に見る。
 */
export function extractTweetArray(parsed: unknown): Json[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(isRecord);
  }
  if (!isRecord(parsed)) {
    return [];
  }

  // エラーレスポンスの場合はここで検出し、呼び出し側でわかりやすいメッセージを出せるようにする
  if (parsed.ok === false && isRecord(parsed.error)) {
    const code = pickString(parsed.error, ["code"]) ?? "unknown_error";
    const message = pickString(parsed.error, ["message"]) ?? "";
    throw new Error(`twitter-cli がエラーを返しました (${code}): ${message}`);
  }

  const wrapperKeys = ["data", "tweets", "items", "results", "timeline", "feed"];
  for (const key of wrapperKeys) {
    const value = parsed[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
    if (isRecord(value)) {
      // さらに1段ネストしているケース（例: data.tweets）
      const nested = extractTweetArray(value);
      if (nested.length > 0) return nested;
    }
  }

  // それでも見つからなければ、オブジェクト自身が単一ツイートである可能性を考慮する
  if (pickString(parsed, ["id", "id_str", "tweetId", "rest_id"]) !== undefined) {
    return [parsed];
  }

  return [];
}

function normalizeAuthor(raw: Json): { name: string; handle: string } {
  const authorObj =
    (isRecord(raw.author) && raw.author) ||
    (isRecord(raw.user) && raw.user) ||
    (isRecord(raw.owner) && raw.owner) ||
    undefined;

  const name =
    (authorObj && pickString(authorObj, ["name", "displayName", "display_name"])) ??
    pickString(raw, ["authorName", "author_name"]) ??
    "不明なユーザー";

  const handleRaw =
    (authorObj &&
      pickString(authorObj, ["username", "screen_name", "handle", "screenName"])) ??
    pickString(raw, ["authorHandle", "handle", "screen_name", "username"]) ??
    "";
  const handle = handleRaw.replace(/^@/, "");

  return { name, handle };
}

function normalizeMetrics(raw: Json): Tweet["metrics"] {
  const metricsObj =
    (isRecord(raw.metrics) && raw.metrics) ||
    (isRecord(raw.publicMetrics) && raw.publicMetrics) ||
    (isRecord(raw.public_metrics) && raw.public_metrics) ||
    raw;

  return {
    likes:
      pickNumber(metricsObj, ["likes", "like_count", "favorite_count", "likeCount"]) ?? 0,
    retweets:
      pickNumber(metricsObj, [
        "retweets",
        "retweet_count",
        "repost_count",
        "retweetCount",
      ]) ?? 0,
    replies:
      pickNumber(metricsObj, ["replies", "reply_count", "replyCount"]) ?? 0,
  };
}

function buildTweetUrl(raw: Json, id: string, handle: string): string | null {
  const direct = pickString(raw, ["url", "permalink", "link"]);
  if (direct) return direct;
  if (id && handle) return `https://x.com/${handle}/status/${id}`;
  return null;
}

let fallbackCounter = 0;

/** twitter-cli 等から得た1件の生ツイートオブジェクトを内部の Tweet 型へ正規化する */
export function normalizeTweet(raw: Json): Tweet {
  const id =
    pickString(raw, ["id", "id_str", "tweetId", "rest_id"]) ??
    `unknown-${++fallbackCounter}`;

  const text =
    pickString(raw, [
      "text",
      "full_text",
      "fullText",
      "content",
      "articleText",
      "body",
    ]) ?? "";

  const { name, handle } = normalizeAuthor(raw);

  const createdAt =
    pickString(raw, ["createdAt", "created_at", "date", "timestamp"]) ?? null;

  const explicitRetweetFlag = pickBoolean(raw, ["isRetweet", "retweeted"]);
  const typeSaysRetweet = pickString(raw, ["type"])?.toLowerCase() === "retweet";
  const hasRetweetedStatus = Boolean(raw.retweeted_status || raw.retweetedStatus);
  const isRetweet = explicitRetweetFlag ?? (typeSaysRetweet || hasRetweetedStatus);

  const isReply = Boolean(
    pickBoolean(raw, ["isReply"]) ??
      pickString(raw, ["inReplyToId", "in_reply_to_status_id", "in_reply_to_user_id"])
  );

  const quotedObj =
    (isRecord(raw.quotedTweet) && raw.quotedTweet) ||
    (isRecord(raw.quoted_status) && raw.quoted_status) ||
    undefined;
  const quotedText = quotedObj
    ? pickString(quotedObj, ["text", "full_text", "fullText"]) ?? null
    : null;

  return {
    id,
    text,
    authorName: name,
    authorHandle: handle,
    createdAt,
    url: buildTweetUrl(raw, id, handle),
    isRetweet,
    isReply,
    quotedText,
    metrics: normalizeMetrics(raw),
    raw,
  };
}

/** parsed JSON/YAML 全体を Tweet[] に変換する */
export function normalizeTimeline(parsed: unknown): Tweet[] {
  const rawTweets = extractTweetArray(parsed);
  return rawTweets.map(normalizeTweet);
}
