import { Children, isValidElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PreparePage } from './PreparePage';
import { initAudio, playQing } from '../platform/feedback';

const store = vi.hoisted(() => ({
  settings: { defaultTarget: 36, scriptureEnabled: false },
  updateSettings: vi.fn(),
  beginSession: vi.fn(),
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
}));
vi.mock('../store/useAppStore', () => ({
  useAppStore: () => store,
}));
vi.mock('../platform/feedback', () => ({
  initAudio: vi.fn(),
  playQing: vi.fn(),
}));

function findClick(node: ReactNode, label: string): (() => void | Promise<void>) | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => void | Promise<void> }>(child)) continue;
    if (child.type === 'button' && child.props.children === label) return child.props.onClick;
    const found = findClick(child.props.children, label);
    if (found) return found;
  }
}

describe('试听提示音', () => {
  it('首次点击等待唤醒完成后自动播放，无需第二次点击', async () => {
    let finishResume!: () => void;
    const resumed = new Promise<void>((resolve) => { finishResume = resolve; });
    vi.mocked(initAudio).mockReturnValueOnce(resumed);
    const preview = findClick(PreparePage(), '试听提示音');
    expect(preview).toBeTypeOf('function');
    const clicked = preview!();
    expect(initAudio).toHaveBeenCalledOnce();
    expect(playQing).not.toHaveBeenCalled();
    finishResume();
    await clicked;
    expect(playQing).toHaveBeenCalledOnce();
  });
});

it('36 次位于无目标与 108 次之间，恢复已保存目标并用于开始练习', () => {
  const page = PreparePage();
  const html = renderToStaticMarkup(page);
  expect(html).toMatch(/无目标<\/button><button class="chip chip-active">36 次<\/button><button class="chip">108 次/);
  findClick(page, '开始')!();
  expect(store.updateSettings).toHaveBeenCalledWith({ defaultTarget: 36 });
  expect(store.beginSession).toHaveBeenCalledWith(36);
});
