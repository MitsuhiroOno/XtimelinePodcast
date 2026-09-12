import { test } from "node:test";
import assert from "node:assert/strict";
import { concatMp3, stripId3v1, stripId3v2 } from "../src/tts/concat.js";
import { resolveVoiceByHost, splitTextForTts, synthesizeScript } from "../src/tts/synthesizeScript.js";
import type { TtsProvider } from "../src/tts/types.js";
import type { PodcastScript } from "../src/types.js";

/** ID3v2タグ付きのダミーmp3を作る（タグサイズはsynchsafe整数） */
function withId3v2(payload: Buffer, tagBodySize = 10): Buffer {
  const header = Buffer.alloc(10);
  header.write("ID3", 0, "ascii");
  header[3] = 3; // version
  header[4] = 0;
  header[5] = 0; // flags（フッタなし）
  header[6] = (tagBodySize >> 21) & 0x7f;
  header[7] = (tagBodySize >> 14) & 0x7f;
  header[8] = (tagBodySize >> 7) & 0x7f;
  header[9] = tagBodySize & 0x7f;
  return Buffer.concat([header, Buffer.alloc(tagBodySize), payload]);
}

test("stripId3v2: 先頭のID3v2タグを取り除く", () => {
  const payload = Buffer.from([0xff, 0xfb, 0x01, 0x02]);
  assert.deepEqual(stripId3v2(withId3v2(payload)), payload);
});

test("stripId3v2: ID3v2タグが無いバッファはそのまま返す", () => {
  const raw = Buffer.from([0xff, 0xfb, 0x01, 0x02]);
  assert.deepEqual(stripId3v2(raw), raw);
});

test("stripId3v1: 末尾のID3v1タグ(128byte)を取り除く", () => {
  const payload = Buffer.alloc(200, 0xaa);
  const tag = Buffer.alloc(128);
  tag.write("TAG", 0, "ascii");
  assert.deepEqual(stripId3v1(Buffer.concat([payload, tag])), payload);
});

test("concatMp3: タグを除去した上で連結する", () => {
  const a = Buffer.from([0xff, 0xfb, 0x11]);
  const b = Buffer.from([0xff, 0xfb, 0x22]);
  const merged = concatMp3([withId3v2(a), withId3v2(b)]);
  assert.deepEqual(merged, Buffer.concat([a, b]));
});

test("resolveVoiceByHost: ホストごとに異なる声が割り当てられる", () => {
  const provider = { name: "fake", defaultVoices: ["v1", "v2", "v3"] } as TtsProvider;
  const assigned = resolveVoiceByHost(["アヤ", "ケン"], provider);
  assert.equal(assigned["アヤ"], "v1");
  assert.equal(assigned["ケン"], "v2");
});

test("resolveVoiceByHost: 明示指定した声は優先され、他ホストとは重複しない", () => {
  const provider = { name: "fake", defaultVoices: ["v1", "v2", "v3"] } as TtsProvider;
  const assigned = resolveVoiceByHost(["アヤ", "ケン"], provider, { ケン: "v1" });
  assert.equal(assigned["ケン"], "v1");
  assert.notEqual(assigned["アヤ"], "v1");
});

test("splitTextForTts: 上限以下ならそのまま1つ", () => {
  assert.deepEqual(splitTextForTts("短いテキスト", 100), ["短いテキスト"]);
});

test("splitTextForTts: 長いテキストは文末で分割される", () => {
  const text = "あ".repeat(50) + "。" + "い".repeat(50) + "。";
  const chunks = splitTextForTts(text, 60);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.join(""), text);
  assert.ok(chunks[0].endsWith("。"), "文末で切れていること");
});

test("synthesizeScript: 全ターンを合成し、元の順序を保って結合する", async () => {
  const calls: string[] = [];
  const provider: TtsProvider = {
    name: "fake",
    defaultVoices: ["v1", "v2"],
    async synthesize({ text, voice }) {
      calls.push(`${voice}:${text}`);
      // 並列実行しても順序が保たれることを確認するため、あえて遅延を変える
      await new Promise((r) => setTimeout(r, text.length % 3));
      return Buffer.from(text, "utf8");
    },
  };

  const script: PodcastScript = {
    title: "t",
    description: "d",
    hosts: ["アヤ", "ケン"],
    turns: [
      { speaker: "アヤ", text: "AAA" },
      { speaker: "ケン", text: "BB" },
      { speaker: "アヤ", text: "C" },
    ],
    topics: [],
  };

  const result = await synthesizeScript(script, { provider, concurrency: 3 });
  assert.equal(result.audio.toString("utf8"), "AAABBC", "ターン順が保たれること");
  assert.equal(result.totalCharacters, 6);
  assert.equal(result.voiceByHost["アヤ"], "v1");
  assert.equal(result.voiceByHost["ケン"], "v2");
  assert.equal(calls.length, 3);
});

test("synthesizeScript: ターンが0件ならAPIを呼ばず空の音声を返す", async () => {
  const provider: TtsProvider = {
    name: "fake",
    defaultVoices: ["v1"],
    async synthesize() {
      throw new Error("呼ばれてはいけない");
    },
  };
  const script: PodcastScript = { title: "t", description: "", hosts: ["A"], turns: [], topics: [] };
  const result = await synthesizeScript(script, { provider });
  assert.equal(result.audio.length, 0);
  assert.equal(result.totalCharacters, 0);
});
