#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import "dotenv/config";
import { Command } from "commander";
import { fetchTimelineViaTwitterCli } from "./ingest/fetchTwitterCli.js";
import { loadTweetsFromFile } from "./ingest/loadFromFile.js";
import { filterTweets } from "./ingest/filterTweets.js";
import { organizeTopics } from "./llm/organizeTopics.js";
import { generateDialogue } from "./llm/generateDialogue.js";
import { renderTranscriptJson, renderTranscriptMarkdown } from "./render/renderTranscript.js";
import { loadScriptFromJson } from "./render/loadScript.js";
import { createOpenAiTtsProvider } from "./tts/openai.js";
import { synthesizeScript } from "./tts/synthesizeScript.js";
import { logger } from "./utils/logger.js";
import type { GenerateOptions, PodcastScript, Tweet } from "./types.js";

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
        timelineType: opts.following ? "following" : "for-you",
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
  .option("--exclude-retweets", "リツイート/リポストを整理対象から除外する")
  .option("--exclude-replies", "リプライを整理対象から除外する")
  .option("--audio <path>", "台本をTTSで音声化してmp3として保存する（OPENAI_API_KEYが必要）")
  .option("--voices <names>", "ホスト順の声をカンマ区切りで指定（例: nova,onyx）")
  .option("--tts-model <model>", "TTSモデル名（省略時は OPENAI_TTS_MODEL / gpt-4o-mini-tts）")
  .option("--speed <number>", "読み上げ速度（0.25〜4.0）")
  .option("--concurrency <number>", "音声合成の同時リクエスト数", "3")
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
  .option("--exclude-retweets", "リツイート/リポストを整理対象から除外する")
  .option("--exclude-replies", "リプライを整理対象から除外する")
  .option("--audio <path>", "台本をTTSで音声化してmp3として保存する（OPENAI_API_KEYが必要）")
  .option("--voices <names>", "ホスト順の声をカンマ区切りで指定（例: nova,onyx）")
  .option("--tts-model <model>", "TTSモデル名（省略時は OPENAI_TTS_MODEL / gpt-4o-mini-tts）")
  .option("--speed <number>", "読み上げ速度（0.25〜4.0）")
  .option("--concurrency <number>", "音声合成の同時リクエスト数", "3")
  .action(async (opts) => {
    try {
      const tweets = await fetchTimelineViaTwitterCli({
        max: Number(opts.max),
        timelineType: opts.following ? "following" : "for-you",
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

program
  .command("speak")
  .description("生成済みの台本JSONをTTSで音声化してmp3を作る（OPENAI_API_KEYが必要）")
  .requiredOption("-i, --input <path>", "`generate --json-output` で保存した台本JSON")
  .requiredOption("-o, --output <path>", "出力先mp3ファイルパス")
  .option("--voices <names>", "ホスト順の声をカンマ区切りで指定（例: nova,onyx）")
  .option("--tts-model <model>", "TTSモデル名（省略時は OPENAI_TTS_MODEL / gpt-4o-mini-tts）")
  .option("--speed <number>", "読み上げ速度（0.25〜4.0）")
  .option("--concurrency <number>", "音声合成の同時リクエスト数", "3")
  .action(async (opts) => {
    try {
      const script = await loadScriptFromJson(opts.input);
      logger.info(`台本を読み込みました（${script.turns.length}ターン、出演: ${script.hosts.join(" / ")}）。`);
      await runSpeak(script, { ...opts, audio: opts.output });
    } catch (err) {
      fail(err);
    }
  });

async function runGenerate(
  allTweets: Tweet[],
  opts: {
    hosts: string;
    language: string;
    turns: string;
    model?: string;
    style?: string;
    maxTweets: string;
    excludeRetweets?: boolean;
    excludeReplies?: boolean;
  }
) {
  const hosts = opts.hosts
    .split(",")
    .map((h: string) => h.trim())
    .filter(Boolean);
  if (hosts.length !== 2) {
    throw new Error("--hosts には必ず2名をカンマ区切りで指定してください（例: --hosts アヤ,ケン）。");
  }

  const tweets = filterTweets(allTweets, {
    excludeRetweets: opts.excludeRetweets,
    excludeReplies: opts.excludeReplies,
    excludeEmptyText: true,
  });
  if (tweets.length !== allTweets.length) {
    logger.info(`フィルタにより ${allTweets.length - tweets.length}件のツイートを除外しました（残り${tweets.length}件）。`);
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
  opts: {
    output: string;
    jsonOutput?: string;
    audio?: string;
    voices?: string;
    ttsModel?: string;
    speed?: string;
    concurrency?: string;
  }
) {
  await writeFile(opts.output, renderTranscriptMarkdown(script), "utf8");
  logger.info(`台本を ${opts.output} に保存しました（${script.turns.length}ターン）。`);
  if (opts.jsonOutput) {
    await writeFile(opts.jsonOutput, renderTranscriptJson(script), "utf8");
    logger.info(`構造化データを ${opts.jsonOutput} に保存しました。`);
  }
  if (opts.audio) {
    await runSpeak(script, { ...opts, audio: opts.audio });
  }
}

/** 台本を音声合成してmp3として保存する */
async function runSpeak(
  script: PodcastScript,
  opts: {
    audio: string;
    voices?: string;
    ttsModel?: string;
    speed?: string;
    concurrency?: string;
  }
) {
  if (script.turns.length === 0) {
    logger.warn("台本のターンが0件のため、音声合成をスキップしました。");
    return;
  }

  const provider = createOpenAiTtsProvider({
    model: opts.ttsModel,
    speed: opts.speed ? Number(opts.speed) : undefined,
  });

  // --voices "nova,onyx" のように、ホストの並び順で声を割り当てる
  const voiceByHost: Record<string, string> = {};
  if (opts.voices) {
    const voices = opts.voices.split(",").map((v) => v.trim()).filter(Boolean);
    script.hosts.forEach((host, i) => {
      if (voices[i]) voiceByHost[host] = voices[i];
    });
  }

  logger.info(`音声を合成しています（${provider.name}）…`);
  const result = await synthesizeScript(script, {
    provider,
    voiceByHost,
    concurrency: opts.concurrency ? Number(opts.concurrency) : 3,
    onProgress: (done, total) => {
      if (done === total || done % 10 === 0) {
        logger.info(`  合成中… ${done}/${total} ターン`);
      }
    },
  });

  await writeFile(opts.audio, result.audio);
  const assignments = Object.entries(result.voiceByHost)
    .map(([host, voice]) => `${host}=${voice}`)
    .join(", ");
  logger.info(
    `音声を ${opts.audio} に保存しました（${(result.audio.length / 1024 / 1024).toFixed(1)}MB, ` +
      `読み上げ${result.totalCharacters}文字, 声: ${assignments}）。`
  );
}

function fail(err: unknown): never {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

program.parseAsync(process.argv);
