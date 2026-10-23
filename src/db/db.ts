// 数据层（技术文档 §6）：Dexie 三个表，库名 prostration-db。
import Dexie, { Table } from 'dexie';

export interface Session {
  id?: number;
  startedAt: number;
  endedAt: number;
  count: number;
  manualAdjust: number;
  target?: number;
  durationSec: number;
}

/** 单行表，id 固定为 1。 */
export interface ScriptureProgress {
  id: number;
  scriptureId: string;
  charIndex: number;
  updatedAt: number;
}

/** 单行表，id 固定为 1。 */
export interface Settings {
  id: number;
  soundOn: boolean;
  scriptureEnabled: boolean;
  defaultTarget?: number;
  /** 俯身识别提示音（低音提示），未设置视为开启。 */
  descentCueOn?: boolean;
  /** 调试：相机页叠加骨架与识别数值。 */
  debugOverlay?: boolean;
  /** 姿态识别引擎，未设置视为 movenet。 */
  poseModel?: PoseModel;
  /** 首次介绍页已看过（点了开始或跳过）。 */
  introSeen?: boolean;
}

export type PoseModel = 'mediapipe' | 'movenet';

export const DEFAULT_SETTINGS: Settings = {
  id: 1,
  soundOn: true,
  scriptureEnabled: false,
};

class ProstrationDB extends Dexie {
  sessions!: Table<Session, number>;
  scriptureProgress!: Table<ScriptureProgress, number>;
  settings!: Table<Settings, number>;

  constructor() {
    super('prostration-db');
    this.version(1).stores({
      sessions: '++id, startedAt',
      scriptureProgress: 'id',
      settings: 'id',
    });
  }
}

export const db = new ProstrationDB();

export async function loadSettings(): Promise<Settings> {
  const s = await db.settings.get(1);
  if (s) return s;
  await db.settings.put(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(s: Settings): Promise<void> {
  await db.settings.put({ ...s, id: 1 });
}

export async function loadProgress(): Promise<ScriptureProgress> {
  const p = await db.scriptureProgress.get(1);
  if (p) return p;
  const init: ScriptureProgress = { id: 1, scriptureId: 'tao-te-ching', charIndex: 0, updatedAt: Date.now() };
  await db.scriptureProgress.put(init);
  return { ...init };
}

export async function saveProgress(charIndex: number): Promise<void> {
  await db.scriptureProgress.put({ id: 1, scriptureId: 'tao-te-ching', charIndex, updatedAt: Date.now() });
}

/** 导出全库 JSON（PRD F5 备份手段）。 */
export async function exportAll(): Promise<string> {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      sessions: await db.sessions.toArray(),
      scriptureProgress: await db.scriptureProgress.toArray(),
      settings: await db.settings.toArray(),
    },
    null,
    2,
  );
}

/** 解析备份文件（用户选的文件，不可信）：只取合法字段，丢弃 id 以免覆盖本机记录。 */
export function parseBackup(json: string): { sessions: Session[]; progress?: ScriptureProgress } {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    data = null;
  }
  if (!data || !Array.isArray(data.sessions)) throw new Error('这不是归元瑜伽计数导出的备份文件');
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const sessions: Session[] = data.sessions
    .filter((s: Session) => s && num(s.startedAt) && num(s.endedAt) && num(s.count) && num(s.durationSec))
    .map((s: Session) => ({
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      count: s.count,
      manualAdjust: num(s.manualAdjust) ? s.manualAdjust : 0,
      durationSec: s.durationSec,
      ...(num(s.target) ? { target: s.target } : {}),
    }));
  const p = Array.isArray(data.scriptureProgress) ? data.scriptureProgress[0] : null;
  const progress =
    p && num(p.charIndex) && num(p.updatedAt)
      ? { id: 1, scriptureId: 'tao-te-ching', charIndex: Math.max(0, Math.floor(p.charIndex)), updatedAt: p.updatedAt }
      : undefined;
  return { sessions, progress };
}

/**
 * 导入备份：与本机记录合并，开始时间相同视为同一条不重复计；
 * 文本进度取较新的一份（本机尚未开始读则以备份为准）；设置保持本机不变。返回新增条数。
 */
export async function importAll(json: string): Promise<number> {
  const { sessions, progress } = parseBackup(json);
  return db.transaction('rw', db.sessions, db.scriptureProgress, async () => {
    const seen = new Set((await db.sessions.toArray()).map((s) => s.startedAt));
    const fresh = sessions.filter((s) => !seen.has(s.startedAt) && seen.add(s.startedAt));
    await db.sessions.bulkAdd(fresh);
    const cur = await db.scriptureProgress.get(1);
    if (progress && (!cur || cur.charIndex === 0 || progress.updatedAt > cur.updatedAt)) {
      await db.scriptureProgress.put(progress);
    }
    return fresh.length;
  });
}
