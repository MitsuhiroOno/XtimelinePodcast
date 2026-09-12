/** 1つの発話を音声に変換するリクエスト */
export interface SynthesizeRequest {
  /** 読み上げるテキスト */
  text: string;
  /** 使用する声の識別子（プロバイダ依存） */
  voice: string;
}

/**
 * 音声合成プロバイダの抽象。OpenAI / ElevenLabs / Google など、
 * 実装を差し替えられるようにこのインターフェースに揃える。
 */
export interface TtsProvider {
  /** ログ表示用の名前（例: "openai:gpt-4o-mini-tts"） */
  readonly name: string;
  /** このプロバイダで使える代表的な声の一覧（先頭から順にホストへ割り当てる） */
  readonly defaultVoices: string[];
  /** 1つの発話をmp3バイナリへ変換する */
  synthesize(request: SynthesizeRequest): Promise<Buffer>;
}
