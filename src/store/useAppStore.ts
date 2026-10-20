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
import { Baseline } from '../engine/types';
import { RepState } from '../engine/stateMachine';
import { scripture } from '../scripture';

export type Page =
  | 'home'
  | 'prepare'
  | 'calibrate'
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
  nearBoundaryEvents: number;
}

interface AppState {
  page: Page;
  supportReasons: string[];
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
  nearBoundaryEvents: number;
  machineState: RepState;
  baseline: Baseline | null;
  lastSummary: SessionSummary | null;

  init(): Promise<void>;
  navigate(page: Page): void;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  refreshSessions(): Promise<void>;

  beginPrepare(): void;
  beginCalibration(target: number | null): void;
  setBaseline(b: Baseline): void;
  startRunning(): void;
  onRepCompleted(): void;
  adjust(delta: number): void;
  resetCount(): void;
  autoPause(): void;
  autoResume(): void;
  interrupt(): void;
  resumeFromInterrupt(): void;
  endSession(): Promise<void>;
  addNearBoundary(): void;
  setMachineState(s: RepState): void;
  markTrialCompleted(): Promise<void>;

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
  nearBoundaryEvents: 0,
  machineState: 'IDLE',
  baseline: null,
  lastSummary: null,

  async init() {
    const [settings, progress, sessions] = await Promise.all([
      loadSettings(),
      loadProgress(),
      db.sessions.orderBy('startedAt').reverse().toArray(),
    ]);
    set({ settings, charIndex: progress.charIndex, sessions });
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

  beginCalibration(target) {
    set({ page: 'calibrate', target });
  },

  setBaseline(baseline) {
    set({ baseline });
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
      nearBoundaryEvents: 0,
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
      nearBoundaryEvents: s.nearBoundaryEvents,
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

  addNearBoundary() {
    set({ nearBoundaryEvents: get().nearBoundaryEvents + 1 });
  },

  setMachineState(machineState) {
    set({ machineState });
  },

  async markTrialCompleted() {
    await get().updateSettings({ completedTrialAt: Date.now() });
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
