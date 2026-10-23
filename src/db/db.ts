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
  /** 下拜识别提示音（颂钵），未设置视为开启。 */
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
