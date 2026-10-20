import { describe, expect, it } from 'vitest';
import { preprocess, scripture } from './index';
import raw from './tao-te-ching.json';

const han = (s: string) => [...s].filter((c) => /\p{Script=Han}/u.test(c));

describe('《道德经》汉字预处理', () => {
  it('81 章、5277 字（只计汉字，标点不入字序）', () => {
    expect(scripture.totalChapters).toBe(81);
    expect(scripture.totalChars).toBe(5277);
    expect(scripture.chars.every((c) => /\p{Script=Han}/u.test(c))).toBe(true);
  });

  it('章节偏移表正确', () => {
    expect(scripture.chapterOffsets).toHaveLength(81);
    expect(scripture.chapterOffsets[0]).toBe(0);
    let acc = 0;
    raw.chapters.forEach((ch, i) => {
      expect(scripture.chapterOffsets[i]).toBe(acc);
      acc += han(ch.text).length;
    });
    expect(acc).toBe(5277);
  });

  it('chapterOf：首字属第 1 章，末字属第 81 章', () => {
    expect(scripture.chapterOf(0)).toBe(1);
    expect(scripture.chapterOf(scripture.chapterOffsets[1])).toBe(2);
    expect(scripture.chapterOf(scripture.totalChars - 1)).toBe(81);
  });

  it('windowAt 返回当前字与上下文窗口', () => {
    const ch1 = han(raw.chapters[0].text);
    const w = scripture.windowAt(0, 6);
    expect(w.current).toBe(ch1[0]);
    expect(w.before).toBe('');
    expect(w.after).toBe(ch1.slice(1, 7).join(''));
    const w2 = scripture.windowAt(3, 2);
    expect(w2.before).toBe(ch1.slice(1, 3).join(''));
    expect(w2.current).toBe(ch1[3]);
  });

  it('preprocess 对空标点文本健壮', () => {
    const s = preprocess({ id: 'x', title: 'x', chapters: [{ n: 1, text: '，。！' }] });
    expect(s.totalChars).toBe(0);
  });
});
