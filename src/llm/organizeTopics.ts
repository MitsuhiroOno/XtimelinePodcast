import type { Tool } from "@anthropic-ai/sdk/resources/messages.js";
import { DEFAULT_MODEL, getAnthropicClient } from "./client.js";
import type { OrganizedTimeline, Topic, Tweet } from "../types.js";

const MAX_TEXT_LENGTH = 280;

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function formatTweetsForPrompt(tweets: Tweet[]): string {
  return tweets
    .map((t) => {
      const flags = [t.isRetweet ? "RT" : null, t.isReply ? "reply" : null]
        .filter(Boolean)
        .join(",");
      const author = t.authorHandle ? `@${t.authorHandle}` : t.authorName;
      const metrics = `like:${t.metrics.likes} rt:${t.metrics.retweets}`;
      const flagsPart = flags ? ` [${flags}]` : "";
      return `[${t.id}] (${author}, ${metrics}${flagsPart}) ${truncate(t.text, MAX_TEXT_LENGTH)}`;
    })
    .join("\n");
}

const organizeTool: Tool = {
  name: "submit_topics",
  description:
    "タイムラインを整理した結果として、トピックのリストと未分類ツイートIDのリストを提出する。",
  input_schema: {
    type: "object",
    properties: {
      topics: {
        type: "array",
        description: "重要度の高い順に並べたトピックのリスト",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "トピックを一目で表す短いタイトル（日本語、15文字程度）",
            },
            summary: {
              type: "string",
              description: "このトピックで何が話題になっているかの2〜3文の要約",
            },
            importance: {
              type: "integer",
              minimum: 1,
              maximum: 5,
              description: "話題としての重要度・盛り上がり度。5が最も重要。",
            },
            tweetIds: {
              type: "array",
              items: { type: "string" },
              description: "このトピックに属するツイートIDの配列",
            },
          },
          required: ["title", "summary", "importance", "tweetIds"],
        },
      },
      unclassifiedTweetIds: {
        type: "array",
        items: { type: "string" },
        description:
          "宣伝・ノイズ・単発すぎて他と関連付けられない等の理由でどのトピックにも入れなかったツイートID",
      },
    },
    required: ["topics", "unclassifiedTweetIds"],
  },
};

const SYSTEM_PROMPT = `あなたはSNSのタイムラインを分析するリサーチアシスタントです。
与えられたX(Twitter)のタイムライン（ツイートのリスト）を読み、話題ごとにグルーピングして整理してください。

ルール:
- 内容が関連する複数のツイートは1つのトピックにまとめること。単発の話題も、内容として意味があれば1トピックにしてよい。
- 明らかな広告・プロモーション・スパム・意味の読み取れない断片は無理にトピック化せず unclassifiedTweetIds に入れる。
- 同じ出来事について複数アカウントが言及している場合は、それらをまとめて1つのトピックにし、複数の視点があることが summary からわかるようにする。
- トピックは importance（重要度・話題性）の高い順に並べる。
- 各ツイートIDは topics か unclassifiedTweetIds のどちらか一方にのみ、正確に一度だけ出現させること（存在しないIDを作らないこと）。
- 出力は必ず日本語で書くこと。
- 必ず submit_topics ツールを呼び出して結果を返すこと。`;

export interface OrganizeOptions {
  model?: string;
  maxTweets?: number;
}

/** ツイート一覧を Claude に渡し、トピックごとに整理させる */
export async function organizeTopics(
  tweets: Tweet[],
  options: OrganizeOptions = {}
): Promise<OrganizedTimeline> {
  if (tweets.length === 0) {
    return { topics: [], unclassifiedTweetIds: [] };
  }

  const maxTweets = options.maxTweets ?? 300;
  const targetTweets = tweets.slice(0, maxTweets);
  const model = options.model ?? DEFAULT_MODEL;

  const client = getAnthropicClient();
  const message = await client.messages.create({
    model,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [organizeTool],
    tool_choice: { type: "tool", name: "submit_topics" },
    messages: [
      {
        role: "user",
        content: `以下は取得したタイムラインです（1行1ツイート、形式: [ID] (投稿者, 指標 [フラグ]) 本文）。\n\n${formatTweetsForPrompt(
          targetTweets
        )}`,
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> =>
      block.type === "tool_use" && block.name === "submit_topics"
  );
  if (!toolUse) {
    throw new Error("Claude からトピック整理結果（tool_use）が返却されませんでした。");
  }

  const input = toolUse.input as {
    topics?: Array<{
      title?: string;
      summary?: string;
      importance?: number;
      tweetIds?: string[];
    }>;
    unclassifiedTweetIds?: string[];
  };

  const validIds = new Set(targetTweets.map((t) => t.id));

  const topics: Topic[] = (input.topics ?? []).map((t) => ({
    title: t.title ?? "(無題)",
    summary: t.summary ?? "",
    importance: clampImportance(t.importance),
    tweetIds: (t.tweetIds ?? []).filter((id) => validIds.has(id)),
  }));

  const unclassifiedTweetIds = (input.unclassifiedTweetIds ?? []).filter((id) =>
    validIds.has(id)
  );

  return { topics, unclassifiedTweetIds };
}

function clampImportance(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 3;
  return Math.min(5, Math.max(1, Math.round(value)));
}
