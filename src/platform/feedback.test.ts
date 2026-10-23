import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function setupAudio() {
  let finishResume!: () => void;
  const context = {
    state: 'suspended' as AudioContextState,
    resume: vi.fn(() => new Promise<void>((resolve) => {
      finishResume = () => {
        context.state = 'running';
        resolve();
      };
    })),
  };
  const AudioContext = vi.fn(function () { return context; });
  vi.stubGlobal('window', { AudioContext });
  vi.stubGlobal('navigator', { audioSession: { type: 'auto' } });
  return { context, AudioContext, finishResume: () => finishResume() };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('音频初始化', () => {
  it('返回的 Promise 等到音频恢复才完成', async () => {
    const { context, finishResume } = setupAudio();
    const { initAudio, audioReady } = await import('./feedback');
    const initialized = initAudio();
    expect(initialized).toBeInstanceOf(Promise);
    const ready = vi.fn();
    void Promise.resolve(initialized).then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    expect(audioReady()).toBe(false);
    finishResume();
    await initialized;
    expect(context.resume).toHaveBeenCalledOnce();
    expect(audioReady()).toBe(true);
    expect(ready).toHaveBeenCalledOnce();
  });

  it('重复初始化复用音频上下文，挂起后可再次唤醒', async () => {
    const { context, AudioContext, finishResume } = setupAudio();
    const { initAudio, audioReady } = await import('./feedback');
    const first = initAudio();
    finishResume();
    await first;
    context.state = 'suspended';
    const resumed = initAudio();
    finishResume();
    await resumed;
    expect(AudioContext).toHaveBeenCalledOnce();
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(audioReady()).toBe(true);
  });

  it('唤醒失败不会产生未处理的拒绝', async () => {
    const { context } = setupAudio();
    context.resume.mockRejectedValueOnce(new Error('blocked'));
    const { initAudio, audioReady } = await import('./feedback');
    await expect(initAudio()).resolves.toBeUndefined();
    expect(audioReady()).toBe(false);
  });

  it('不支持音频时仍返回可等待的结果', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {});
    const { initAudio, audioReady } = await import('./feedback');
    await expect(initAudio()).resolves.toBeUndefined();
    expect(audioReady()).toBe(false);
  });
});

describe('进入准备页', () => {
  it.each(['beginPrepare', 'navigate'] as const)('%s 在导航时立即开始唤醒音频', async (entry) => {
    const { context } = setupAudio();
    const { useAppStore } = await import('../store/useAppStore');
    if (entry === 'beginPrepare') useAppStore.getState().beginPrepare();
    else useAppStore.getState().navigate('prepare');
    expect(context.resume).toHaveBeenCalledOnce();
    expect(useAppStore.getState().page).toBe('prepare');
    expect(context.state).toBe('suspended');
  });
});
