// 《道德经》运行时预处理：只有汉字入字序（标点不计数，已确认的产品决策），
// 标点保留为显示用 token；产出汉字数组 + 每章起始偏移表 + 每章 token 表。
import raw from './tao-te-ching.json';

export interface RawScripture {
  id: string;
  title: string;
  chapters: { n: number; text: string }[];
}

/** 显示用 token：汉字带全文字序 i，标点 i = -1。 */
export interface Token {
  c: string;
  i: number;
}

export interface Scripture {
  id: string;
  title: string;
  /** 全文汉字序列。 */
  chars: string[];
  totalChars: number;
  totalChapters: number;
  /** 每章起始字偏移（与 chapters[n] 对齐）。 */
  chapterOffsets: number[];
  /** 每章含标点的 token 序列。 */
  chapterTokens: Token[][];
  /** 字所在章（1 起）。 */
  chapterOf(charIndex: number): number;
}

export function preprocess(rawData: RawScripture): Scripture {
  const chars: string[] = [];
  const chapterOffsets: number[] = [];
  const chapterTokens: Token[][] = [];
  for (const ch of rawData.chapters) {
    chapterOffsets.push(chars.length);
    const tokens: Token[] = [];
    for (const c of ch.text) {
      if (/\p{Script=Han}/u.test(c)) {
        tokens.push({ c, i: chars.length });
        chars.push(c);
      } else if (c.trim()) {
        tokens.push({ c, i: -1 });
      }
    }
    chapterTokens.push(tokens);
  }
  const totalChars = chars.length;

  const chapterOf = (charIndex: number): number => {
    let lo = 0;
    let hi = chapterOffsets.length - 1;
    while (lo < hi) {
      const midIdx = Math.ceil((lo + hi) / 2);
      if (chapterOffsets[midIdx] <= charIndex) lo = midIdx;
      else hi = midIdx - 1;
    }
    return lo + 1;
  };

  return {
    id: rawData.id,
    title: rawData.title,
    chars,
    totalChars,
    totalChapters: rawData.chapters.length,
    chapterOffsets,
    chapterTokens,
    chapterOf,
  };
}

const DIGITS = '零一二三四五六七八九';
/** 章名：1 → 第一章，21 → 第二十一章（1–99）。 */
export function chapterName(n: number): string {
  const t = Math.floor(n / 10);
  const u = n % 10;
  const tens = t === 0 ? '' : (t === 1 ? '' : DIGITS[t]) + '十';
  return `第${tens}${u || !tens ? DIGITS[u] : ''}章`;
}

export const scripture: Scripture = preprocess(raw as RawScripture);
