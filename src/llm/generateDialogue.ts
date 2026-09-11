import type { Tool } from "@anthropic-ai/sdk/resources/messages.js";
import { DEFAULT_MODEL, getAnthropicClient } from "./client.js";
import type {
  DialogueTurn,
  GenerateOptions,
  OrganizedTimeline,
  PodcastScript,
  Topic,
  Tweet,
} from "../types.js";

const MAX_TWEETS_PER_TOPIC = 6;
const MAX_TEXT_LENGTH = 300;

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function formatTopicsForPrompt(topics: Topic[], tweetsById: Map<string, Tweet>): string {
  return topics
    .map((topic, i) => {
      const tweetLines = topic.tweetIds
        .slice(0, MAX_TWEETS_PER_TOPIC)
        .map((id) => tweetsById.get(id))
        .filter((t): t is Tweet => Boolean(t))
        .map((t) => {
          const author = t.authorHandle ? `@${t.authorHandle}` : t.authorName;
          return `  - (${author}) ${truncate(t.text, MAX_TEXT_LENGTH)}`;
        })
        .join("\n");

      return (
        `# トピック${i + 1}: ${topic.title}（重要度 ${topic.importance}/5）\n` +
        `概要: ${topic.summary}\n` +
        `根拠となったツイート:\n${tweetLines || "  (本文情報なし)"}`
      );
    })
    .join("\n\n");
}

const dialogueTool: Tool = {
  name: "submit_script",
  description: "生成したポッドキャスト台本を提出する。",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "エピソードタイトル" },
      description: { type: "string", description: "1〜2文のエピソード概要" },
      turns: {
        type: "array",
        description: "発話ターンの配列。イントロからアウトロまで順番通りに並べる。",
        items: {
          type: "object",
          properties: {
            speaker: { type: "string", description: "話者名（ホスト名のいずれか）" },
            text: { type: "string", description: "その発話の本文" },
          },
          required: ["speaker", "text"],
        },
      },
    },
    required: ["title", "description", "turns"],
  },
};

function buildSystemPrompt(options: GenerateOptions): string {
  const [hostA, hostB] = options.hosts;
  const styleNote = options.styleNote
    ? `\n追加の演出指示: ${options.styleNote}`
    : "";

  return `あなたはNotebookLMの「Audio Overview」のような、2人のAIホストが自然な会話でニュースを解説する
ポッドキャストの台本作家です。以下の条件で、渡されたトピック一覧をもとに1本のエピソード台本を作ってください。

登場人物:
- ${hostA}: 好奇心旺盛な聞き役。話を掘り下げる質問をしたり、リスナー視点でのコメントをする。
- ${hostB}: 物知りな解説役。背景や文脈を補足しつつ、${hostA}の質問に答える。

台本のルール:
- 言語は${options.language === "ja" ? "日本語" : options.language}。
- 冒頭に短いイントロ（番組・今回のテーマ紹介）、末尾に短いアウトロ（まとめ・締めの挨拶）を入れる。
- トピックは重要度が高いものから順に自然な会話の流れで取り上げ、トピック間は自然な相槌や一言つなぎで移動する。
- ツイートの文面をそのまま読み上げるのではなく、内容を要約・言い換えて、2人が意見交換したり驚いたり突っ込みを入れたりする自然な会話にする。
- 事実として断定しすぎず、あくまで「Xでこういう投稿が話題になっている」という temperature 感を保つ。個人アカウントの発言は断定的な事実として扱わない。
- 誇張しすぎず、かといって単調な要約の読み上げにもしない。実際のポッドキャストのような掛け合い・テンポを意識する。
- ターン数の目安は${options.targetTurns}前後（イントロ・アウトロ含む）。1ターンは1〜4文程度。
- speaker には必ず "${hostA}" か "${hostB}" のいずれかを正確に入れる。${styleNote}
- 必ず submit_script ツールを呼び出して結果を返すこと。`;
}

/** 整理済みトピック一覧から、Claude を使ってポッドキャスト風の対話台本を生成する */
export async function generateDialogue(
  organized: OrganizedTimeline,
  tweets: Tweet[],
  options: GenerateOptions
): Promise<PodcastScript> {
  if (organized.topics.length === 0) {
    return {
      title: "今日のタイムラインまとめ",
      description: "整理できるトピックが見つかりませんでした。",
      hosts: options.hosts,
      turns: [],
      topics: [],
    };
  }

  const tweetsById = new Map(tweets.map((t) => [t.id, t]));
  const model = options.model ?? DEFAULT_MODEL;
  const client = getAnthropicClient();

  const message = await client.messages.create({
    model,
    max_tokens: 8000,
    system: buildSystemPrompt(options),
    tools: [dialogueTool],
    tool_choice: { type: "tool", name: "submit_script" },
    messages: [
      {
        role: "user",
        content: `以下は今回のエピソードで扱うトピック一覧です。\n\n${formatTopicsForPrompt(
          organized.topics,
          tweetsById
        )}`,
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> =>
      block.type === "tool_use" && block.name === "submit_script"
  );
  if (!toolUse) {
    throw new Error("Claude から台本（tool_use）が返却されませんでした。");
  }

  const input = toolUse.input as {
    title?: string;
    description?: string;
    turns?: Array<{ speaker?: string; text?: string }>;
  };

  const validSpeakers = new Set(options.hosts);
  const turns: DialogueTurn[] = (input.turns ?? [])
    .filter((t) => typeof t.text === "string" && t.text.trim().length > 0)
    .map((t) => ({
      speaker: t.speaker && validSpeakers.has(t.speaker) ? t.speaker : options.hosts[0],
      text: t.text!.trim(),
    }));

  return {
    title: input.title ?? "今日のタイムラインまとめ",
    description: input.description ?? "",
    hosts: options.hosts,
    turns,
    topics: organized.topics,
  };
}
