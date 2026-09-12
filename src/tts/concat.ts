/**
 * 複数のmp3バイナリを1つに結合する。
 *
 * ffmpeg のような外部ツールに依存せずに済ませるため、各mp3から
 * ID3v2（先頭）/ ID3v1（末尾）のメタデータを取り除いた上で、
 * 生のMPEGオーディオフレーム列として単純連結する。
 * 同一のエンコード設定（同じモデル・フォーマット）で生成された
 * mp3同士であれば、この方法で問題なく通しで再生できる。
 */
export function concatMp3(buffers: Buffer[]): Buffer {
  const frames = buffers
    .map((buf) => stripId3v1(stripId3v2(buf)))
    .filter((buf) => buf.length > 0);
  return Buffer.concat(frames);
}

/**
 * 先頭のID3v2タグを取り除く。
 * ID3v2ヘッダは "ID3" + バージョン2byte + フラグ1byte + サイズ4byte(synchsafe) の計10byte。
 */
export function stripId3v2(buf: Buffer): Buffer {
  if (buf.length < 10) return buf;
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return buf; // "ID3" でなければ何もしない

  // synchsafe integer: 各バイトの下位7bitのみを使う
  const size =
    ((buf[6] & 0x7f) << 21) |
    ((buf[7] & 0x7f) << 14) |
    ((buf[8] & 0x7f) << 7) |
    (buf[9] & 0x7f);

  const flags = buf[5];
  const hasFooter = (flags & 0x10) !== 0; // フッタ付きの場合はさらに10byte
  const totalTagSize = 10 + size + (hasFooter ? 10 : 0);

  return totalTagSize < buf.length ? buf.subarray(totalTagSize) : buf;
}

/** 末尾のID3v1タグ（128byte、先頭が "TAG"）を取り除く */
export function stripId3v1(buf: Buffer): Buffer {
  if (buf.length < 128) return buf;
  const tagStart = buf.length - 128;
  if (buf[tagStart] === 0x54 && buf[tagStart + 1] === 0x41 && buf[tagStart + 2] === 0x47) {
    return buf.subarray(0, tagStart);
  }
  return buf;
}
