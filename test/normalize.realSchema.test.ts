import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTimeline } from "../src/ingest/normalize.js";

/**
 * PyPI版 twitter-cli (0.8.5) の実ソース (serialization.py の tweet_to_dict /
 * output.py の success_payload) を確認して得た、実際の `feed --json` 出力形式。
 * このテストはその形式が壊れないことを固定するための回帰テスト。
 */
test("実際のtwitter-cli出力スキーマ(0.8.5)を正しく正規化できる", () => {
  const parsed = {
    ok: true,
    schema_version: "1",
    data: [
      {
        id: "1001",
        text: "新しいJSランタイムのベンチマークを公開しました。",
        author: {
          id: "u1",
          name: "Dev Taro",
          screenName: "dev_taro",
          profileImageUrl: "https://example.com/a.png",
          verified: false,
        },
        metrics: { likes: 512, retweets: 120, replies: 34, quotes: 2, views: 9000, bookmarks: 10 },
        createdAt: "Thu Sep 10 09:00:00 +0000 2026",
        createdAtLocal: "2026-09-10 18:00:00",
        createdAtISO: "2026-09-10T09:00:00+00:00",
        media: [],
        urls: [],
        isRetweet: false,
        retweetedBy: null,
        lang: "ja",
        score: null,
      },
      {
        id: "1002",
        text: "",
        author: { id: "u2", name: "News Desk", screenName: "newsdesk" },
        metrics: { likes: 8, retweets: 3, replies: 0, quotes: 0, views: 0, bookmarks: 0 },
        createdAt: "Thu Sep 10 10:20:00 +0000 2026",
        createdAtISO: "2026-09-10T10:20:00+00:00",
        isRetweet: false,
        lang: "ja",
        articleTitle: "新しい省エネ家電の補助金制度",
        articleText: "来月から申請受付が始まる新制度の詳細はこちら。",
      },
      {
        id: "1003",
        text: "RTした内容です",
        author: { id: "u3", name: "Saito", screenName: "saito_x" },
        metrics: { likes: 1, retweets: 0, replies: 0, quotes: 0, views: 0, bookmarks: 0 },
        createdAt: "Thu Sep 10 10:30:00 +0000 2026",
        createdAtISO: "2026-09-10T10:30:00+00:00",
        isRetweet: true,
        retweetedBy: "saito_x",
        lang: "ja",
      },
    ],
  };

  const tweets = normalizeTimeline(parsed);
  assert.equal(tweets.length, 3);

  const [t1, t2, t3] = tweets;

  assert.equal(t1.authorHandle, "dev_taro");
  assert.equal(t1.authorName, "Dev Taro");
  assert.equal(t1.metrics.likes, 512);
  assert.equal(t1.metrics.retweets, 120);
  assert.equal(t1.metrics.replies, 34);
  // createdAtISO を優先して採用する
  assert.equal(t1.createdAt, "2026-09-10T09:00:00+00:00");
  assert.equal(t1.isRetweet, false);
  assert.equal(t1.url, "https://x.com/dev_taro/status/1001");

  // text が空でも articleTitle/articleText から本文を組み立てる
  assert.match(t2.text, /新しい省エネ家電の補助金制度/);
  assert.match(t2.text, /来月から申請受付が始まる/);

  assert.equal(t3.isRetweet, true);
});
