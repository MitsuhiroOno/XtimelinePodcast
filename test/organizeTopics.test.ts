import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { setAnthropicClientForTesting } from "../src/llm/client.js";
import { organizeTopics } from "../src/llm/organizeTopics.js";
import type { Tweet } from "../src/types.js";

function makeTweet(id: string, text: string): Tweet {
  return {
    id,
    text,
    authorName: "Someone",
    authorHandle: "someone",
    createdAt: null,
    url: null,
    isRetweet: false,
    isReply: false,
    quotedText: null,
    metrics: { likes: 0, retweets: 0, replies: 0 },
  };
}

/** messages.create が固定の tool_use レスポンスを返す偽Anthropicクライアントを作る */
function fakeClientReturning(toolName: string, input: unknown): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "tool_use", name: toolName, id: "toolu_1", input }],
      }),
    },
  } as unknown as Anthropic;
}

test("organizeTopics: 存在しないツイートIDはtopics/unclassifiedから除外される", async (t) => {
  t.after(() => setAnthropicClientForTesting(null));

  const tweets = [makeTweet("1", "A"), makeTweet("2", "B")];
  setAnthropicClientForTesting(
    fakeClientReturning("submit_topics", {
      topics: [
        {
          title: "テスト",
          summary: "要約",
          importance: 4,
          tweetIds: ["1", "999-does-not-exist"],
        },
      ],
      unclassifiedTweetIds: ["2", "also-missing"],
    })
  );

  const result = await organizeTopics(tweets);
  assert.equal(result.topics.length, 1);
  assert.deepEqual(result.topics[0].tweetIds, ["1"]);
  assert.deepEqual(result.unclassifiedTweetIds, ["2"]);
});

test("organizeTopics: importanceは1〜5にクランプされる", async (t) => {
  t.after(() => setAnthropicClientForTesting(null));

  const tweets = [makeTweet("1", "A")];
  setAnthropicClientForTesting(
    fakeClientReturning("submit_topics", {
      topics: [
        { title: "T1", summary: "S", importance: 99, tweetIds: ["1"] },
        { title: "T2", summary: "S", importance: -5, tweetIds: [] },
      ],
      unclassifiedTweetIds: [],
    })
  );

  const result = await organizeTopics(tweets);
  assert.equal(result.topics[0].importance, 5);
  assert.equal(result.topics[1].importance, 1);
});

test("organizeTopics: ツイートが0件なら空の結果を返しAPIを呼ばない", async () => {
  // クライアントを設定しない状態で呼ぶ（呼ばれたらAPIキー未設定エラーになるはず）
  setAnthropicClientForTesting(null);
  const result = await organizeTopics([]);
  assert.deepEqual(result, { topics: [], unclassifiedTweetIds: [] });
});
