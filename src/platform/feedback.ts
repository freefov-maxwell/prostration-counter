// 声音/震动反馈（PRD F8）。AudioContext 必须在用户手势中初始化（iOS 限制）。
let ctx: AudioContext | null = null;

export function initAudio(): void {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) ctx = new AC();
  }
  ctx?.resume().catch(() => undefined);
}

/** 短促木鱼声：三角形波高频起振 + 快速指数衰减。 */
export function playTick(): void {
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(880, t0);
  osc.frequency.exponentialRampToValueAtTime(440, t0 + 0.06);
  gain.gain.setValueAtTime(0.5, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.2);
}

/** 目标达成音：两声上行。 */
export function playGoal(): void {
  if (!ctx || ctx.state !== 'running') return;
  const c = ctx;
  const t0 = c.currentTime;
  [523, 784].forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = t0 + i * 0.18;
    gain.gain.setValueAtTime(0.4, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.45);
  });
}

/** iOS 无 Vibration API，静默跳过。 */
export function vibrate(ms: number | number[]): void {
  if ('vibrate' in navigator) navigator.vibrate(ms);
}

/** 预生成的校准语音（public/voice/*.mp3，由 scripts/gen-voice.py 生成，键与 scripts/voice-lines.json 一致）。 */
export type VoiceKey =
  | 'enter'
  | 'headOut'
  | 'feetOut'
  | 'tooFar'
  | 'hold'
  | 'trial'
  | 'safe'
  | 'close'
  | 'tooClose'
  | 'wrongDirection'
  | 'retry';

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
