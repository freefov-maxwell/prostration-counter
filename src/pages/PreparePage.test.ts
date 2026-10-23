import { Children, isValidElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PreparePage } from './PreparePage';
import { initAudio, playQing } from '../platform/feedback';

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock('../store/useAppStore', () => ({
  useAppStore: () => ({ settings: {} }),
}));
vi.mock('../platform/feedback', () => ({
  initAudio: vi.fn(),
  playQing: vi.fn(),
}));

function findPreview(node: ReactNode): (() => Promise<void>) | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => Promise<void> }>(child)) continue;
    if (child.type === 'button' && child.props.children === '试听提示音') return child.props.onClick;
    const found = findPreview(child.props.children);
    if (found) return found;
  }
}

describe('试听提示音', () => {
  it('首次点击等待唤醒完成后自动播放，无需第二次点击', async () => {
    let finishResume!: () => void;
    const resumed = new Promise<void>((resolve) => { finishResume = resolve; });
    vi.mocked(initAudio).mockReturnValueOnce(resumed);
    const preview = findPreview(PreparePage());
    expect(preview).toBeTypeOf('function');
    const clicked = preview!();
    expect(initAudio).toHaveBeenCalledOnce();
    expect(playQing).not.toHaveBeenCalled();
    finishResume();
    await clicked;
    expect(playQing).toHaveBeenCalledOnce();
  });
});
