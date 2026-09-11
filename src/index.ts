export * from "./types.js";
export { normalizeTimeline, normalizeTweet, extractTweetArray } from "./ingest/normalize.js";
export { loadTweetsFromFile } from "./ingest/loadFromFile.js";
export { fetchTimelineViaTwitterCli } from "./ingest/fetchTwitterCli.js";
export { organizeTopics } from "./llm/organizeTopics.js";
export { generateDialogue } from "./llm/generateDialogue.js";
export { renderTranscriptMarkdown, renderTranscriptJson } from "./render/renderTranscript.js";

import type { GenerateOptions, PodcastScript, Tweet } from "./types.js";
import { organizeTopics } from "./llm/organizeTopics.js";
import { generateDialogue } from "./llm/generateDialogue.js";

export interface RunPipelineOptions extends Partial<GenerateOptions> {
  model?: string;
}

/**
 * ツイート一覧から「整理 → 台本生成」までを一気に行う高レベルAPI。
 * デフォルトはホスト2人（アヤ/ケン）・日本語・ターン数目安40。
 */
export async function runPipeline(
  tweets: Tweet[],
  options: RunPipelineOptions = {}
): Promise<PodcastScript> {
  const generateOptions: GenerateOptions = {
    hosts: options.hosts ?? ["アヤ", "ケン"],
    language: options.language ?? "ja",
    targetTurns: options.targetTurns ?? 40,
    model: options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    styleNote: options.styleNote,
  };

  const organized = await organizeTopics(tweets, { model: generateOptions.model });
  return generateDialogue(organized, tweets, generateOptions);
}
