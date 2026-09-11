import type { PodcastScript } from "../types.js";

/** PodcastScript を人が読みやすい Markdown 台本に変換する */
export function renderTranscriptMarkdown(script: PodcastScript): string {
  const lines: string[] = [];

  lines.push(`# ${script.title}`);
  lines.push("");
  if (script.description) {
    lines.push(`> ${script.description}`);
    lines.push("");
  }
  lines.push(`出演: ${script.hosts.join(" / ")}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const turn of script.turns) {
    lines.push(`**${turn.speaker}**: ${turn.text}`);
    lines.push("");
  }

  if (script.topics.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## 取り上げたトピック");
    lines.push("");
    script.topics.forEach((topic, i) => {
      lines.push(`${i + 1}. **${topic.title}**（重要度 ${topic.importance}/5） — ${topic.summary}`);
    });
    lines.push("");
  }

  return lines.join("\n");
}

/** PodcastScript をそのままJSONとして保存する用（構造データが必要な場合） */
export function renderTranscriptJson(script: PodcastScript): string {
  return JSON.stringify(script, null, 2);
}
