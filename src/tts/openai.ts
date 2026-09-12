import type { SynthesizeRequest, TtsProvider } from "./types.js";

const API_URL = "https://api.openai.com/v1/audio/speech";

/** OpenAI TTS で利用できる声。先頭から順にホストへ割り当てられる */
export const OPENAI_VOICES = [
  "nova",
  "onyx",
  "shimmer",
  "echo",
  "alloy",
  "fable",
  "ballad",
  "coral",
  "sage",
  "verse",
];

export interface OpenAiTtsOptions {
  /** 省略時は環境変数 OPENAI_API_KEY を使用 */
  apiKey?: string;
  /** 省略時は環境変数 OPENAI_TTS_MODEL、それも無ければ gpt-4o-mini-tts */
  model?: string;
  /** 読み上げ速度（0.25〜4.0）。省略時はAPI既定値 */
  speed?: number;
  /** 声のトーンに関する指示（gpt-4o-mini-tts 系のみ有効） */
  instructions?: string;
  /** リトライ回数（429/5xx時）。既定3回 */
  maxRetries?: number;
}

/** OpenAI の Audio Speech API を使う TtsProvider を生成する */
export function createOpenAiTtsProvider(options: OpenAiTtsOptions = {}): TtsProvider {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY が設定されていません。.env に設定するか、環境変数として export してください。"
    );
  }
  const model = options.model ?? process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
  const maxRetries = options.maxRetries ?? 3;

  return {
    name: `openai:${model}`,
    defaultVoices: OPENAI_VOICES,
    async synthesize({ text, voice }: SynthesizeRequest): Promise<Buffer> {
      const body: Record<string, unknown> = {
        model,
        input: text,
        voice,
        response_format: "mp3",
      };
      if (options.speed !== undefined) body.speed = options.speed;
      if (options.instructions) body.instructions = options.instructions;

      let lastError: unknown;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetch(API_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });

          if (res.ok) {
            return Buffer.from(await res.arrayBuffer());
          }

          const detail = await res.text().catch(() => "");
          // 429(レート制限) と 5xx は一時的な可能性が高いのでリトライする
          if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
            lastError = new Error(`OpenAI TTS API エラー (${res.status}): ${detail.slice(0, 300)}`);
            await sleep(2 ** attempt * 1000);
            continue;
          }
          throw new Error(`OpenAI TTS API エラー (${res.status}): ${detail.slice(0, 500)}`);
        } catch (err) {
          // ネットワークエラー等もリトライ対象にする
          if (attempt < maxRetries && !(err instanceof Error && err.message.startsWith("OpenAI TTS API エラー"))) {
            lastError = err;
            await sleep(2 ** attempt * 1000);
            continue;
          }
          throw err;
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
