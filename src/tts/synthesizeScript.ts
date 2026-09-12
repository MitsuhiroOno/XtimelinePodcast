import type { PodcastScript } from "../types.js";
import { concatMp3 } from "./concat.js";
import type { TtsProvider } from "./types.js";

/** OpenAI TTS の入力上限は4096文字。安全マージンを取って分割する */
const MAX_INPUT_CHARS = 3500;

export interface SynthesizeScriptOptions {
  provider: TtsProvider;
  /** ホスト名 → 声 の明示的な割り当て。未指定のホストには既定の声を順に割り当てる */
  voiceByHost?: Record<string, string>;
  /** 同時リクエスト数。既定3 */
  concurrency?: number;
  /** 進捗通知（合成済みターン数 / 全ターン数） */
  onProgress?: (done: number, total: number) => void;
}

export interface SynthesizeScriptResult {
  /** 結合済みのmp3バイナリ */
  audio: Buffer;
  /** 読み上げた総文字数（課金量の目安） */
  totalCharacters: number;
  /** 実際に使われたホスト名→声の割り当て */
  voiceByHost: Record<string, string>;
}

/** ホストへ声を割り当てる。明示指定が無いホストには provider の既定の声を順に使う */
export function resolveVoiceByHost(
  hosts: string[],
  provider: TtsProvider,
  overrides: Record<string, string> = {}
): Record<string, string> {
  const result: Record<string, string> = {};
  let nextVoiceIndex = 0;
  const used = new Set(Object.values(overrides));

  for (const host of hosts) {
    if (overrides[host]) {
      result[host] = overrides[host];
      continue;
    }
    // まだ使われていない既定の声を探す（ホスト同士で声が被らないように）
    while (
      nextVoiceIndex < provider.defaultVoices.length &&
      used.has(provider.defaultVoices[nextVoiceIndex])
    ) {
      nextVoiceIndex++;
    }
    const voice =
      provider.defaultVoices[nextVoiceIndex] ??
      provider.defaultVoices[nextVoiceIndex % provider.defaultVoices.length] ??
      provider.defaultVoices[0];
    result[host] = voice;
    used.add(voice);
    nextVoiceIndex++;
  }
  return result;
}

/** 長すぎるテキストを、なるべく文の切れ目で分割する */
export function splitTextForTts(text: string, maxChars: number = MAX_INPUT_CHARS): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    // 日本語・英語どちらの文末でも切れるように候補を探す
    const breakPoint = Math.max(
      window.lastIndexOf("。"),
      window.lastIndexOf("！"),
      window.lastIndexOf("？"),
      window.lastIndexOf(". "),
      window.lastIndexOf("\n")
    );
    const cut = breakPoint > maxChars * 0.3 ? breakPoint + 1 : maxChars;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim().length > 0) chunks.push(rest);
  return chunks;
}

/** 台本の全ターンを音声合成し、1本のmp3に結合する */
export async function synthesizeScript(
  script: PodcastScript,
  options: SynthesizeScriptOptions
): Promise<SynthesizeScriptResult> {
  const { provider, concurrency = 3, onProgress } = options;
  const voiceByHost = resolveVoiceByHost(script.hosts, provider, options.voiceByHost ?? {});

  const total = script.turns.length;
  if (total === 0) {
    return { audio: Buffer.alloc(0), totalCharacters: 0, voiceByHost };
  }

  const results: Buffer[][] = new Array(total);
  let totalCharacters = 0;
  let done = 0;
  let nextIndex = 0;

  // 同時実行数を絞りつつ、結果は元のターン順を保って格納する
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= total) return;

      const turn = script.turns[index];
      const voice = voiceByHost[turn.speaker] ?? provider.defaultVoices[0];
      const chunks = splitTextForTts(turn.text);
      totalCharacters += turn.text.length;

      const audioChunks: Buffer[] = [];
      for (const chunk of chunks) {
        audioChunks.push(await provider.synthesize({ text: chunk, voice }));
      }
      results[index] = audioChunks;

      done++;
      onProgress?.(done, total);
    }
  });

  await Promise.all(workers);

  return {
    audio: concatMp3(results.flat()),
    totalCharacters,
    voiceByHost,
  };
}
