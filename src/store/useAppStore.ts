import { create } from 'zustand';
import {
  db,
  DEFAULT_SETTINGS,
  loadProgress,
  loadSettings,
  saveProgress,
  saveSettings,
  Session,
  Settings,
} from '../db/db';
import { RepState } from '../engine/stateMachine';
import { scripture } from '../scripture';

export type Page =
  | 'home'
  | 'prepare'
  | 'session'
  | 'summary'
  | 'stats'
  | 'settings'
  | 'unsupported';

export type SessionStatus = 'running' | 'autoPaused' | 'interrupted';

export interface SessionSummary {
  count: number;
  durationSec: number;
  avgPaceSec: number | null;
  target: number | null;
}

interface AppState {
  page: Page;
  supportReasons: string[];
  /** 本地数据已读入；之前 settings/sessions 是默认值，不能据此判断是否新用户。 */
  ready: boolean;
  settings: Settings;
  sessions: Session[];
  charIndex: number;

  // 会话运行时
  target: number | null;
  sessionCount: number;
  manualAdjust: number;
  sessionStatus: SessionStatus;
  startedAt: number;
  activeMs: number;
  resumeMark: number;
  machineState: RepState;
  lastSummary: SessionSummary | null;

  init(): Promise<void>;
  navigate(page: Page): void;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  refreshSessions(): Promise<void>;

  beginPrepare(): void;
  beginSession(target: number | null): void;
  /** 起始站位完成、开始计数：会话计时从此刻算起。 */
  startRunning(): void;
  onRepCompleted(): void;
  adjust(delta: number): void;
  resetCount(): void;
  autoPause(): void;
  autoResume(): void;
  interrupt(): void;
  resumeFromInterrupt(): void;
  endSession(): Promise<void>;
  setMachineState(s: RepState): void;

  deleteSession(id: number): Promise<void>;
  jumpChar(index: number): Promise<void>;
  resetProgress(): Promise<void>;
}

export function sessionDurationSec(s: Pick<AppState, 'activeMs' | 'resumeMark' | 'sessionStatus'>): number {
  const extra = s.sessionStatus === 'running' ? Date.now() - s.resumeMark : 0;
  return Math.round((s.activeMs + extra) / 1000);
}

export const useAppStore = create<AppState>((set, get) => ({
  page: 'home',
  supportReasons: [],
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  sessions: [],
  charIndex: 0,

  target: null,
  sessionCount: 0,
  manualAdjust: 0,
  sessionStatus: 'running',
  startedAt: 0,
  activeMs: 0,
  resumeMark: 0,
  machineState: 'IDLE',
  lastSummary: null,

  async init() {
    const [settings, progress, sessions] = await Promise.all([
      loadSettings(),
      loadProgress(),
      db.sessions.orderBy('startedAt').reverse().toArray(),
    ]);
    set({ settings, charIndex: progress.charIndex, sessions, ready: true });
  },

  navigate(page) {
    set({ page });
  },

  async updateSettings(patch) {
    const settings = { ...get().settings, ...patch, id: 1 };
    await saveSettings(settings);
    set({ settings });
  },

  async refreshSessions() {
    const sessions = await db.sessions.orderBy('startedAt').reverse().toArray();
    set({ sessions });
  },

  beginPrepare() {
    set({ page: 'prepare' });
  },

  beginSession(target) {
    get().startRunning();
    set({ target });
  },

  startRunning() {
    const now = Date.now();
    set({
      page: 'session',
      sessionCount: 0,
      manualAdjust: 0,
      sessionStatus: 'running',
      startedAt: now,
      activeMs: 0,
      resumeMark: now,
      machineState: 'IDLE',
    });
  },

  onRepCompleted() {
    const { sessionCount, settings, charIndex } = get();
    const next = sessionCount + 1;
    const patch: Partial<AppState> = { sessionCount: next };
    if (settings.scriptureEnabled) {
      const nextChar = (charIndex + 1) % scripture.totalChars;
      patch.charIndex = nextChar;
      void saveProgress(nextChar);
    }
    set(patch as AppState);
  },

  adjust(delta) {
    const { sessionCount, manualAdjust, settings, charIndex } = get();
    const next = Math.max(0, sessionCount + delta);
    const applied = next - sessionCount;
    if (applied === 0) return;
    const patch: Partial<AppState> = {
      sessionCount: next,
      manualAdjust: manualAdjust + applied,
    };
    if (settings.scriptureEnabled) {
      const nextChar = Math.max(0, Math.min(charIndex + applied, scripture.totalChars - 1));
      patch.charIndex = nextChar;
      void saveProgress(nextChar);
    }
    set(patch as AppState);
  },

  resetCount() {
    const { sessionCount, manualAdjust } = get();
    set({ sessionCount: 0, manualAdjust: manualAdjust - sessionCount });
  },

  autoPause() {
    const { sessionStatus, activeMs, resumeMark } = get();
    if (sessionStatus !== 'running') return;
    set({ sessionStatus: 'autoPaused', activeMs: activeMs + (Date.now() - resumeMark) });
  },

  autoResume() {
    if (get().sessionStatus !== 'autoPaused') return;
    set({ sessionStatus: 'running', resumeMark: Date.now() });
  },

  interrupt() {
    const { sessionStatus, activeMs, resumeMark, page } = get();
    if (page !== 'session' || sessionStatus !== 'running') return;
    set({ sessionStatus: 'interrupted', activeMs: activeMs + (Date.now() - resumeMark) });
  },

  resumeFromInterrupt() {
    if (get().sessionStatus !== 'interrupted') return;
    set({ sessionStatus: 'running', resumeMark: Date.now() });
  },

  async endSession() {
    const s = get();
    const durationSec =
      s.sessionStatus === 'running'
        ? Math.round((s.activeMs + (Date.now() - s.resumeMark)) / 1000)
        : Math.round(s.activeMs / 1000);
    const summary: SessionSummary = {
      count: s.sessionCount,
      durationSec,
      avgPaceSec: s.sessionCount > 0 ? Math.round((durationSec / s.sessionCount) * 10) / 10 : null,
      target: s.target,
    };
    // 次数为 0 的会话不保存
    if (s.sessionCount > 0) {
      await db.sessions.add({
        startedAt: s.startedAt,
        endedAt: Date.now(),
        count: s.sessionCount,
        manualAdjust: s.manualAdjust,
        target: s.target ?? undefined,
        durationSec,
      });
      await get().refreshSessions();
    }
    set({ lastSummary: summary, page: 'summary' });
  },

  setMachineState(machineState) {
    set({ machineState });
  },

  async deleteSession(id) {
    await db.sessions.delete(id);
    await get().refreshSessions();
  },

  async jumpChar(index) {
    const next = Math.max(0, Math.min(index, scripture.totalChars - 1));
    await saveProgress(next);
    set({ charIndex: next });
  },

  async resetProgress() {
    await saveProgress(0);
    set({ charIndex: 0 });
  },
}));
