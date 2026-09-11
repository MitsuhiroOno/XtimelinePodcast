import Anthropic from "@anthropic-ai/sdk";

let cachedClient: Anthropic | null = null;

/** 環境変数 ANTHROPIC_API_KEY から Anthropic クライアントを生成する（遅延初期化・シングルトン） */
export function getAnthropicClient(): Anthropic {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY が設定されていません。.env ファイルに設定するか、" +
        "環境変数として export してください（.env.example を参照）。"
    );
  }

  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

/** 明示指定がない場合に使うデフォルトモデル */
export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
