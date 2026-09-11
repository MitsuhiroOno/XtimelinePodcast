/**
 * twitter-cli (https://github.com/public-clis/twitter-cli) などから取得した
 * 生のタイムラインデータを正規化した、パイプライン内部共通のツイート表現。
 *
 * twitter-cli の出力スキーマはバージョンによって変わり得るため、
 * normalize() 側でフィールド名の揺らぎを吸収する前提の緩い形にしている。
 */
export interface Tweet {
  /** ツイートID（不明な場合は連番などのフォールバックID） */
  id: string;
  /** 本文（リツイートの場合は引用元の本文、リプライの場合はそのリプライ本文） */
  text: string;
  /** 投稿者の表示名 */
  authorName: string;
  /** 投稿者の @handle（不明な場合は空文字） */
  authorHandle: string;
  /** ISO8601等の日時文字列。不明な場合は null */
  createdAt: string | null;
  /** ツイートへのURL。不明な場合は null */
  url: string | null;
  /** リツイート/リポストかどうか */
  isRetweet: boolean;
  /** リプライかどうか */
  isReply: boolean;
  /** 引用ツイートの引用元本文（あれば） */
  quotedText: string | null;
  /** エンゲージメント指標（取得できないものは 0） */
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
  };
  /** 元データのうち正規化しきれなかった情報（デバッグ用） */
  raw?: unknown;
}

/** LLM がタイムラインを整理して抽出した1トピック */
export interface Topic {
  /** トピックの短いタイトル */
  title: string;
  /** トピックの2〜3文程度の要約 */
  summary: string;
  /** 重要度（1〜5、5が最重要） */
  importance: number;
  /** このトピックに属するツイートのID一覧 */
  tweetIds: string[];
}

export interface OrganizedTimeline {
  topics: Topic[];
  /** どのトピックにも分類されなかったツイートのID */
  unclassifiedTweetIds: string[];
}

/** ポッドキャスト台本内の1つの発話ターン */
export interface DialogueTurn {
  /** 話者名（ホスト名） */
  speaker: string;
  /** 発話内容 */
  text: string;
}

export interface PodcastScript {
  /** エピソードタイトル */
  title: string;
  /** エピソードの一言概要 */
  description: string;
  /** ホスト名一覧 */
  hosts: string[];
  /** 発話ターンの配列（イントロ〜アウトロを含む） */
  turns: DialogueTurn[];
  /** 参考にしたトピック一覧 */
  topics: Topic[];
}

export interface GenerateOptions {
  /** ホスト名（デフォルト2人） */
  hosts: string[];
  /** 生成する言語（デフォルト "ja"） */
  language: string;
  /** 台本のおおよそのターン数の目安 */
  targetTurns: number;
  /** 使用するモデル名 */
  model: string;
  /** 番組のトーン・世界観の追加指示（任意） */
  styleNote?: string;
}
