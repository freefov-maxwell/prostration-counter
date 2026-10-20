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
  vibrationOn: boolean;
  scriptureEnabled: boolean;
  defaultTarget?: number;
  /** 首次使用强制完成校准（含试拜）；完成后记录时间。 */
  completedTrialAt?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 1,
  soundOn: true,
  vibrationOn: true,
  scriptureEnabled: true,
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
