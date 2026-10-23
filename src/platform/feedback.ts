// 声音/震动反馈（PRD F8）。AudioContext 必须在用户手势中初始化（iOS 限制）。
let ctx: AudioContext | null = null;

export async function initAudio(): Promise<void> {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) ctx = new AC();
  }
  // iOS 17+：按媒体播放处理，静音键打开时也能出声；不支持的环境忽略
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'playback';
  await ctx?.resume().catch(() => undefined);
}

/** 声音是否可播放；被系统挂起（锁屏、来电、切后台）时为 false，需用户点击后 initAudio 恢复。 */
export function audioReady(): boolean {
  return ctx?.state === 'running';
}

/** 一个分音：频率倍数、峰值音量、衰减时长（秒）。 */
type Partial = [ratio: number, gain: number, decay: number];

/** 敲击类乐器：多个正弦分音同时起振、各自指数衰减；略失谐的分音对产生拍频（低音提示的"嗡嗡"感）。 */
function strike(f0: number, partials: Partial[], attack: number, master: number, delay = 0): void {
  if (!ctx || ctx.state !== 'running') return;
  const c = ctx;
  const t0 = c.currentTime + delay;
  const out = c.createGain();
  out.gain.value = master;
  out.connect(c.destination);
  for (const [ratio, gain, decay] of partials) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = f0 * ratio;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.05);
  }
}

/** 低沉、悠长的提示音：俯身已识别。 */
export function playBowl(): void {
  strike(
    196,
    [
      [1, 0.6, 3.2],
      [1.007, 0.4, 3.2],
      [2.76, 0.22, 2],
      [5.4, 0.1, 1.1],
      [8.93, 0.04, 0.6],
    ],
    0.02,
    0.55,
  );
}

/** 提示音（清亮、短促）：一次动作完成计数。 */
export function playQing(delay = 0, f0 = 784): void {
  strike(
    f0,
    [
      [1, 0.55, 1.6],
      [1.004, 0.3, 1.6],
      [2.42, 0.22, 0.9],
      [4.13, 0.1, 0.45],
      [6.38, 0.05, 0.25],
    ],
    0.003,
    0.45,
    delay,
  );
}

/** 倒数节拍：短促轻响。 */
export function playTick(): void {
  strike(1200, [[1, 0.5, 0.12], [2.7, 0.15, 0.06]], 0.002, 0.35);
}

/** 目标达成：两声上行的提示音。 */
export function playGoal(): void {
  playQing(0, 784);
  playQing(0.45, 1046);
}

/** 预生成的提示语音（public/voice/*.mp3）。 */
export type VoiceKey =
  | 'enter'
  | 'headOut'
  | 'feetOut'
  | 'tooFar'
  | 'pose'
  | 'hold'
  | 'ready'
  | 'discarded'
  | 'paused'
  | 'resumed'
  | 'goal';

const voices = new Map<VoiceKey, Promise<AudioBuffer | null>>();
let voiceSrc: AudioBufferSourceNode | null = null;

function loadVoice(key: VoiceKey): Promise<AudioBuffer | null> {
  let p = voices.get(key);
  if (!p && ctx) {
    const c = ctx;
    p = fetch(`${import.meta.env.BASE_URL}voice/${key}.mp3`)
      .then((r) => r.arrayBuffer())
      .then((b) => c.decodeAudioData(b))
      .catch(() => null);
    voices.set(key, p);
  }
  return p ?? Promise.resolve(null);
}

export function preloadVoices(keys: VoiceKey[]): void {
  keys.forEach((k) => void loadVoice(k));
}

/** 播放一条语音；新语音打断正在播的旧语音。 */
export function playVoice(key: VoiceKey): void {
  if (!ctx || ctx.state !== 'running') return;
  void loadVoice(key).then((buf) => {
    if (!buf || !ctx) return;
    voiceSrc?.stop();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    voiceSrc = src;
  });
}
