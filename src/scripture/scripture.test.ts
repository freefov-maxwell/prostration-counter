import { describe, expect, it } from 'vitest';
import { chapterName, preprocess, scripture } from './index';
import raw from './tao-te-ching.json';

const han = (s: string) => [...s].filter((c) => /\p{Script=Han}/u.test(c));

describe('《道德经》汉字预处理', () => {
  it('81 章、5327 字（只计汉字，标点不入字序）', () => {
    expect(scripture.totalChapters).toBe(81);
    expect(scripture.totalChars).toBe(5327);
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
    expect(acc).toBe(5327);
  });

  it('chapterOf：首字属第 1 章，末字属第 81 章', () => {
    expect(scripture.chapterOf(0)).toBe(1);
    expect(scripture.chapterOf(scripture.chapterOffsets[1])).toBe(2);
    expect(scripture.chapterOf(scripture.totalChars - 1)).toBe(81);
  });

  it('标点 token 不计数，章 token 中汉字字序连续', () => {
    const all = scripture.chapterTokens.flat().filter((t) => t.i >= 0);
    expect(all.map((t) => t.i)).toEqual([...Array(5327).keys()]);
  });

  it('chapterName', () => {
    expect([1, 10, 11, 20, 21, 81].map(chapterName)).toEqual([
      '第一章 体道', '第十章 能为', '第十一章 无用', '第二十章 异俗', '第二十一章 虚心', '第八十一章 显质',
    ]);
  });

  it('preprocess 对空标点文本健壮', () => {
    const s = preprocess({ id: 'x', title: 'x', chapters: [{ n: 1, text: '，。！' }] });
    expect(s.totalChars).toBe(0);
    expect(s.chapterTokens[0].every((t) => t.i === -1)).toBe(true);
  });
});
