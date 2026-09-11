#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import "dotenv/config";
import { Command } from "commander";
import { fetchTimelineViaTwitterCli } from "./ingest/fetchTwitterCli.js";
import { loadTweetsFromFile } from "./ingest/loadFromFile.js";
import { organizeTopics } from "./llm/organizeTopics.js";
import { generateDialogue } from "./llm/generateDialogue.js";
import { renderTranscriptJson, renderTranscriptMarkdown } from "./render/renderTranscript.js";
import { logger } from "./utils/logger.js";
import type { GenerateOptions, Tweet } from "./types.js";

const program = new Command();

program
  .name("xtimeline-podcast")
  .description(
    "X(Twitter)のタイムラインを整理し、NotebookLMのAudio Overviewのような" +
      "2人のAIホストによる会話形式のポッドキャスト台本を生成するCLI"
  )
  .version("0.1.0");

program
  .command("fetch")
  .description("twitter-cli経由でタイムラインを取得し、正規化済みJSONとして保存する")
  .option("-m, --max <number>", "取得件数の上限", "100")
  .option("--following", "ホームタイムラインではなくフォロー中タイムラインを取得する")
  .option("-o, --output <path>", "出力先JSONファイルパス", "tweets.json")
  .action(async (opts) => {
    try {
      const tweets = await fetchTimelineViaTwitterCli({
        max: Number(opts.max),
        timelineType: opts.following ? "following" : "home",
      });
      await writeFile(opts.output, JSON.stringify(tweets, null, 2), "utf8");
      logger.info(`${tweets.length}件のツイートを取得し ${opts.output} に保存しました。`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("generate")
  .description("ツイートJSON/YAMLファイルからポッドキャスト台本を生成する")
  .requiredOption("-i, --input <path>", "twitter-cliの出力(JSON/YAML)、または`fetch`が保存したJSON")
  .option("-o, --output <path>", "出力先Markdownファイルパス", "podcast.md")
  .option("--json-output <path>", "構造化データ(JSON)も併せて保存する場合の出力先パス")
  .option("--hosts <names>", "ホスト名をカンマ区切りで指定（例: アヤ,ケン）", "アヤ,ケン")
  .option("--language <lang>", "台本の言語", "ja")
  .option("--turns <number>", "台本の目安ターン数", "40")
  .option("--model <model>", "使用するモデル名（省略時は環境変数 ANTHROPIC_MODEL / claude-sonnet-5）")
  .option("--style <note>", "番組のトーンに関する追加指示")
  .option("--max-tweets <number>", "整理対象とするツイート数の上限", "300")
  .action(async (opts) => {
    try {
      const tweets = await loadTweetsFromFile(opts.input);
      if (tweets.length === 0) {
        logger.warn("入力ファイルからツイートを1件も抽出できませんでした。フォーマットを確認してください。");
      }
      const script = await runGenerate(tweets, opts);
      await writeOutputs(script, opts);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("run")
  .description("fetch と generate をまとめて実行する（twitter-cliから直接取得→台本生成）")
  .option("-m, --max <number>", "取得件数の上限", "100")
  .option("--following", "ホームタイムラインではなくフォロー中タイムラインを取得する")
  .option("-o, --output <path>", "出力先Markdownファイルパス", "podcast.md")
  .option("--json-output <path>", "構造化データ(JSON)も併せて保存する場合の出力先パス")
  .option("--save-tweets <path>", "取得した生ツイートJSONも保存する場合の出力先パス")
  .option("--hosts <names>", "ホスト名をカンマ区切りで指定（例: アヤ,ケン）", "アヤ,ケン")
  .option("--language <lang>", "台本の言語", "ja")
  .option("--turns <number>", "台本の目安ターン数", "40")
  .option("--model <model>", "使用するモデル名（省略時は環境変数 ANTHROPIC_MODEL / claude-sonnet-5）")
  .option("--style <note>", "番組のトーンに関する追加指示")
  .option("--max-tweets <number>", "整理対象とするツイート数の上限", "300")
  .action(async (opts) => {
    try {
      const tweets = await fetchTimelineViaTwitterCli({
        max: Number(opts.max),
        timelineType: opts.following ? "following" : "home",
      });
      logger.info(`${tweets.length}件のツイートを取得しました。`);
      if (opts.saveTweets) {
        await writeFile(opts.saveTweets, JSON.stringify(tweets, null, 2), "utf8");
      }
      const script = await runGenerate(tweets, opts);
      await writeOutputs(script, opts);
    } catch (err) {
      fail(err);
    }
  });

async function runGenerate(
  tweets: Tweet[],
  opts: {
    hosts: string;
    language: string;
    turns: string;
    model?: string;
    style?: string;
    maxTweets: string;
  }
) {
  const hosts = opts.hosts
    .split(",")
    .map((h: string) => h.trim())
    .filter(Boolean);
  if (hosts.length !== 2) {
    throw new Error("--hosts には必ず2名をカンマ区切りで指定してください（例: --hosts アヤ,ケン）。");
  }

  logger.info("タイムラインをトピックごとに整理しています…");
  const organized = await organizeTopics(tweets, {
    model: opts.model,
    maxTweets: Number(opts.maxTweets),
  });
  logger.info(
    `${organized.topics.length}件のトピックに整理しました（未分類: ${organized.unclassifiedTweetIds.length}件）。`
  );

  const generateOptions: GenerateOptions = {
    hosts,
    language: opts.language,
    targetTurns: Number(opts.turns),
    model: opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    styleNote: opts.style,
  };

  logger.info("ポッドキャスト台本を生成しています…");
  return generateDialogue(organized, tweets, generateOptions);
}

async function writeOutputs(
  script: Awaited<ReturnType<typeof generateDialogue>>,
  opts: { output: string; jsonOutput?: string }
) {
  await writeFile(opts.output, renderTranscriptMarkdown(script), "utf8");
  logger.info(`台本を ${opts.output} に保存しました（${script.turns.length}ターン）。`);
  if (opts.jsonOutput) {
    await writeFile(opts.jsonOutput, renderTranscriptJson(script), "utf8");
    logger.info(`構造化データを ${opts.jsonOutput} に保存しました。`);
  }
}

function fail(err: unknown): never {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

program.parseAsync(process.argv);
