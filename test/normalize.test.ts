import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTimeline } from "../src/ingest/normalize.js";

test("エンベロープ形式(ok/data/pagination)からツイート配列を正規化できる", () => {
  const parsed = {
    ok: true,
    schema_version: "1.0",
    data: [
      {
        id: "1",
        text: "Hello world",
        author: { name: "Alice", username: "alice" },
        created_at: "2026-01-01T00:00:00Z",
        public_metrics: { like_count: 10, retweet_count: 2, reply_count: 1 },
      },
    ],
    pagination: { next_cursor: null },
  };

  const tweets = normalizeTimeline(parsed);
  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].id, "1");
  assert.equal(tweets[0].text, "Hello world");
  assert.equal(tweets[0].authorHandle, "alice");
  assert.equal(tweets[0].metrics.likes, 10);
  assert.equal(tweets[0].isRetweet, false);
});

test("type=retweet のツイートを isRetweet=true として扱う", () => {
  const parsed = [
    {
      id: "2",
      text: "RT something",
      type: "retweet",
      author: { name: "Bob", username: "bob" },
    },
  ];
  const tweets = normalizeTimeline(parsed);
  assert.equal(tweets[0].isRetweet, true);
});

test("配列そのものが渡された場合も正規化できる", () => {
  const parsed = [
    { id: "3", full_text: "Full text form", user: { screen_name: "carol" } },
  ];
  const tweets = normalizeTimeline(parsed);
  assert.equal(tweets[0].text, "Full text form");
  assert.equal(tweets[0].authorHandle, "carol");
});

test("エラーレスポンスは例外として送出される", () => {
  const parsed = {
    ok: false,
    error: { code: "not_authenticated", message: "ログインが必要です" },
  };
  assert.throws(() => normalizeTimeline(parsed), /not_authenticated/);
});

test("IDが取れないツイートにはフォールバックIDが振られる", () => {
  const parsed = [{ text: "no id here" }, { text: "no id here 2" }];
  const tweets = normalizeTimeline(parsed);
  assert.notEqual(tweets[0].id, tweets[1].id);
});
