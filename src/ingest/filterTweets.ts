import type { Tweet } from "../types.js";

export interface FilterOptions {
  /** リツイート/リポストを除外する */
  excludeRetweets?: boolean;
  /** リプライを除外する */
  excludeReplies?: boolean;
  /** 本文が空のツイートを除外する（画像のみの投稿等） */
  excludeEmptyText?: boolean;
}

/** トピック整理・台本生成に渡す前に、不要なツイートを除外する */
export function filterTweets(tweets: Tweet[], options: FilterOptions = {}): Tweet[] {
  return tweets.filter((t) => {
    if (options.excludeRetweets && t.isRetweet) return false;
    if (options.excludeReplies && t.isReply) return false;
    if (options.excludeEmptyText && t.text.trim() === "") return false;
    return true;
  });
}
