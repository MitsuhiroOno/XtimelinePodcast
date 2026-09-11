import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { setAnthropicClientForTesting } from "../src/llm/client.js";
import { generateDialogue } from "../src/llm/generateDialogue.js";
import type { GenerateOptions, OrganizedTimeline, Tweet } from "../src/types.js";

function fakeClientReturning(toolName: string, input: unknown): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "tool_use", name: toolName, id: "toolu_1", input }],
      }),
    },
  } as unknown as Anthropic;
}

const baseOptions: GenerateOptions = {
  hosts: ["アヤ", "ケン"],
  language: "ja",
  targetTurns: 20,
  model: "claude-sonnet-5",
};

test("generateDialogue: トピックが空なら台本生成をスキップしてAPIを呼ばない", async () => {
  setAnthropicClientForTesting(null);
  const organized: OrganizedTimeline = { topics: [], unclassifiedTweetIds: [] };
  const script = await generateDialogue(organized, [], baseOptions);
  assert.equal(script.turns.length, 0);
  assert.deepEqual(script.hosts, ["アヤ", "ケン"]);
});

test("generateDialogue: 未知のspeaker名はホスト1人目にフォールバックされる", async (t) => {
  t.after(() => setAnthropicClientForTesting(null));

  const tweets: Tweet[] = [];
  const organized: OrganizedTimeline = {
    topics: [{ title: "T", summary: "S", importance: 5, tweetIds: [] }],
    unclassifiedTweetIds: [],
  };

  setAnthropicClientForTesting(
    fakeClientReturning("submit_script", {
      title: "エピソード1",
      description: "説明",
      turns: [
        { speaker: "アヤ", text: "こんにちは" },
        { speaker: "謎のナレーター", text: "不正な話者名" },
        { speaker: "ケン", text: "" }, // 空文字は除外されるべき
      ],
    })
  );

  const script = await generateDialogue(organized, tweets, baseOptions);
  assert.equal(script.turns.length, 2);
  assert.equal(script.turns[0].speaker, "アヤ");
  assert.equal(script.turns[1].speaker, "アヤ"); // フォールバック
});
