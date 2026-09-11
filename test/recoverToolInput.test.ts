import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverStringifiedToolInput } from "../src/llm/recoverToolInput.js";

test("通常のオブジェクト入力はそのまま返す", () => {
  const input = { topics: [{ title: "A" }], unclassifiedTweetIds: ["1"] };
  assert.deepEqual(recoverStringifiedToolInput(input), input);
});

test("実機で確認されたケース: 1つのキーにオブジェクト全体がJSON文字列化されている", () => {
  // claude-sonnet-5 で実際に観測された形。topics キーの値として
  // { topics: [...], unclassifiedTweetIds: [...] } 全体がJSON文字列化されて入っていた。
  const stringified = JSON.stringify({
    topics: [{ title: "T", summary: "S", importance: 3, tweetIds: ["1"] }],
    unclassifiedTweetIds: ["2"],
  });
  const input = { topics: stringified };

  const recovered = recoverStringifiedToolInput(input);
  assert.deepEqual(recovered.topics, [
    { title: "T", summary: "S", importance: 3, tweetIds: ["1"] },
  ]);
  assert.deepEqual(recovered.unclassifiedTweetIds, ["2"]);
});

test("実機で確認されたケース: 先頭の`{\"key\":`が欠落した壊れたJSON文字列", () => {
  // 本来 {"topics":[...],"unclassifiedTweetIds":[...]} となるはずが、
  // topics キーの値として "[...],\"unclassifiedTweetIds\":[...]}" という
  // （それ単体ではJSONとして不正な）文字列が返ってきたケース。
  const broken = '[{"title":"T","summary":"S","importance":3,"tweetIds":["1"]}],"unclassifiedTweetIds":["2"]}';
  const input = { topics: broken };

  const recovered = recoverStringifiedToolInput(input);
  assert.deepEqual(recovered.topics, [
    { title: "T", summary: "S", importance: 3, tweetIds: ["1"] },
  ]);
  assert.deepEqual(recovered.unclassifiedTweetIds, ["2"]);
});

test("単純に配列だけがJSON文字列化されているケース", () => {
  const input = { turns: JSON.stringify([{ speaker: "A", text: "hi" }]) };
  const recovered = recoverStringifiedToolInput(input);
  assert.deepEqual(recovered.turns, [{ speaker: "A", text: "hi" }]);
});

test("JSONとして解釈できない文字列はそのまま残す", () => {
  const input = { title: "ただの文字列です" };
  assert.deepEqual(recoverStringifiedToolInput(input), input);
});

test("null/配列/非オブジェクトの入力に対しては空オブジェクトを返す", () => {
  assert.deepEqual(recoverStringifiedToolInput(null), {});
  assert.deepEqual(recoverStringifiedToolInput([1, 2, 3]), {});
  assert.deepEqual(recoverStringifiedToolInput("plain string"), {});
});
