import { describe, expect, it } from 'vitest';
import { parseBackup } from './db';

describe('parseBackup 备份解析', () => {
  it('取合法记录、丢弃 id 与坏行、读出经书进度', () => {
    const json = JSON.stringify({
      sessions: [
        { id: 7, startedAt: 1, endedAt: 2, count: 10, manualAdjust: 1, durationSec: 60, target: 108 },
        { startedAt: 'x', endedAt: 2, count: 1, durationSec: 1 },
      ],
      scriptureProgress: [{ id: 1, scriptureId: 'tao-te-ching', charIndex: 42, updatedAt: 5 }],
    });
    const r = parseBackup(json);
    expect(r.sessions).toEqual([{ startedAt: 1, endedAt: 2, count: 10, manualAdjust: 1, durationSec: 60, target: 108 }]);
    expect(r.progress?.charIndex).toBe(42);
  });

  it('非备份文件报错', () => {
    expect(() => parseBackup('not json')).toThrow('备份文件');
    expect(() => parseBackup('{"a":1}')).toThrow('备份文件');
  });
});
