// 《道德经》运行时预处理：只保留汉字（标点不入字序，已确认的产品决策），
// 产出汉字数组 + 每章起始偏移表，O(1) 取第 N 字与上下文窗口。
import raw from './tao-te-ching.json';

export interface RawScripture {
  id: string;
  title: string;
  chapters: { n: number; text: string }[];
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
  /** 字所在章（1 起）。 */
  chapterOf(charIndex: number): number;
  /** 当前字 + 前后各 radius 字的上下文窗口。 */
  windowAt(charIndex: number, radius: number): { before: string; current: string; after: string };
}

export function preprocess(rawData: RawScripture): Scripture {
  const chars: string[] = [];
  const chapterOffsets: number[] = [];
  for (const ch of rawData.chapters) {
    chapterOffsets.push(chars.length);
    for (const c of ch.text) {
      if (/\p{Script=Han}/u.test(c)) chars.push(c);
    }
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

  const windowAt = (charIndex: number, radius: number) => {
    const i = Math.max(0, Math.min(charIndex, totalChars - 1));
    const slice = (a: number, b: number) =>
      chars.slice(Math.max(0, a), Math.min(totalChars, b)).join('');
    return {
      before: slice(i - radius, i),
      current: chars[i] ?? '',
      after: slice(i + 1, i + 1 + radius),
    };
  };

  return {
    id: rawData.id,
    title: rawData.title,
    chars,
    totalChars,
    totalChapters: rawData.chapters.length,
    chapterOffsets,
    chapterOf,
    windowAt,
  };
}

export const scripture: Scripture = preprocess(raw as RawScripture);
