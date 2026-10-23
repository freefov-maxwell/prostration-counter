import { useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { exportAll } from '../db/db';
import { downloadJson } from '../platform/overlay';
import { chapterName, scripture, type Token } from '../scripture';

/** 每个字连同其后的标点分为一组：按钮是原子行内块，不分组的话标点会被挤到行首。 */
function groupWithPunct(tokens: Token[]): Token[][] {
  const groups: Token[][] = [];
  for (const t of tokens) {
    if (t.i >= 0 || !groups.length) groups.push([t]);
    else groups[groups.length - 1].push(t);
  }
  return groups;
}

/** 按章浏览原文的 3 行滑动窗口：打开时当前进度行居中，滑动点选任意字，确认后作为新进度。 */
function ScripturePicker({ current, onJump }: { current: number; onJump: (i: number) => void }) {
  const currentChapter = scripture.chapterOf(current);
  const [chapter, setChapter] = useState(currentChapter);
  const [picked, setPicked] = useState<number | null>(null);
  /** 每次「回到当前位置」+1，触发重新定位。 */
  const [recenter, setRecenter] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const cur = chapter === currentChapter ? box.querySelector<HTMLElement>(`[data-i="${current}"]`) : null;
    const lh = parseFloat(getComputedStyle(box).lineHeight);
    box.scrollTop = cur ? (Math.round(cur.offsetTop / lh) - 1) * lh : 0;
  }, [chapter, currentChapter, current, recenter]);

  return (
    <>
      <select
        className="input"
        value={chapter}
        onChange={(e) => {
          setChapter(Number(e.target.value));
          setPicked(null);
        }}
        aria-label="选择章节"
      >
        {scripture.chapterTokens.map((_, k) => (
          <option key={k} value={k + 1}>
            {chapterName(k + 1)}
          </option>
        ))}
      </select>
      <div ref={boxRef} className="scripture-picker">
        {groupWithPunct(scripture.chapterTokens[chapter - 1]).map(([t, ...punct]) => (
          <span key={t.i} className="nowrap">
            <button
              data-i={t.i}
              className={t.i === picked ? 'picked' : t.i === current ? 'progress-char' : undefined}
              onClick={() => setPicked(t.i)}
            >
              {t.c}
            </button>
            {punct.map((p) => p.c).join('')}
          </span>
        ))}
      </div>
      <p className="hint">滑动选字，点选一个字作为新的起点（红框字为当前进度）。</p>
      <div className="btn-row">
        <button
          className="btn-secondary"
          disabled={picked == null}
          onClick={() => {
            if (picked == null) return;
            setChapter(scripture.chapterOf(picked));
            onJump(picked);
            setPicked(null);
          }}
        >
          跳转到此字
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            setChapter(currentChapter);
            setPicked(null);
            setRecenter((n) => n + 1);
          }}
        >
          回到当前位置
        </button>
      </div>
    </>
  );
}

export function SettingsPage() {
  const { settings, updateSettings, charIndex, jumpChar, resetProgress, navigate, importBackup, sessions } = useAppStore();
  const [importMsg, setImportMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const pct = ((charIndex / scripture.totalChars) * 100).toFixed(1);
  const chapter = scripture.chapterOf(Math.max(0, charIndex - 1));

  const doExport = async () => {
    downloadJson(`dalibai-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportAll());
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const added = await importBackup(await file.text());
      setImportMsg(added ? `导入成功：新增 ${added} 条练习记录。` : '导入完成：备份里的记录本机都已有，没有新增。');
    } catch (e) {
      setImportMsg(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <button className="btn-text" onClick={() => navigate('home')}>
          ‹ 返回
        </button>
        <h2>设置</h2>
        <span />
      </header>

      <section className="section">
        <h3>文本进度</h3>
        <p className="hint">
          《{scripture.title}》第 {charIndex} 字 / 共 {scripture.totalChars} 字（{pct}%），当前{chapterName(chapter)}
        </p>
        <ScripturePicker current={charIndex} onJump={(i) => void jumpChar(i)} />
        {confirmReset ? (
          <div className="btn-row">
            <button
              className="btn-danger"
              onClick={() => {
                void resetProgress();
                setConfirmReset(false);
              }}
            >
              确认重置进度
            </button>
            <button className="btn-secondary" onClick={() => setConfirmReset(false)}>
              取消
            </button>
          </div>
        ) : (
          <button className="btn-secondary" onClick={() => setConfirmReset(true)}>
            重置文本进度
          </button>
        )}
      </section>

      <section className="section">
        <h3>反馈</h3>
        <label className="switch-row">
          <span>默认显示《道德经》逐字</span>
          <input
            type="checkbox"
            checked={settings.scriptureEnabled}
            onChange={(e) => void updateSettings({ scriptureEnabled: e.target.checked })}
          />
        </label>
      </section>

      <section className="section">
        <h3>数据备份与恢复</h3>
        <p className="hint">
          你的 {sessions.length} 条练习记录和文本进度只保存在这台手机的浏览器里，没有云端。
          换手机、清理浏览器数据或删除主屏幕图标之前，请先导出备份。
        </p>
        <ol className="hint">
          <li>点「导出备份」，得到一个 dalibai-backup-日期.json 文件，把它存到网盘、发给自己（如微信文件传输助手）或电脑上。</li>
          <li>在新手机上打开本应用，点「导入备份」，选择这个文件即可恢复。</li>
        </ol>
        <p className="hint">导入是合并，不会删除本机已有记录，重复导入同一份也不会重复计数；文本进度取较新的一份。</p>
        <div className="btn-row">
          <button className="btn-secondary" onClick={() => void doExport()}>
            导出备份
          </button>
          <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
            导入备份
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              void doImport(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        {importMsg && (
          <p className="hint" role="status">
            {importMsg}
          </p>
        )}
      </section>

      <section className="section">
        <h3>调试</h3>
        <label className="switch-row">
          <span>相机页显示骨架与识别数值</span>
          <input
            type="checkbox"
            checked={!!settings.debugOverlay}
            onChange={(e) => void updateSettings({ debugOverlay: e.target.checked })}
          />
        </label>
        <label className="switch-row">
          <span>使用高精度识别模型 MediaPipe</span>
          <input
            type="checkbox"
            checked={settings.poseModel === 'mediapipe'}
            onChange={(e) => void updateSettings({ poseModel: e.target.checked ? 'mediapipe' : 'movenet' })}
          />
        </label>
        <p className="hint">默认的轻量模型计数不准时可开启。识别更稳，但首次使用另需下载约 17 MB，手机负担更重，需浏览器支持 WebGL2。</p>
      </section>

      <section className="section">
        <h3>关于</h3>
        <p className="hint">
          归元瑜伽计数 v0.1 · 纯本地运行：视频不出设备，数据仅存本机，无任何网络请求与埋点。
          练习时建议插电使用。提示语音为 AI 合成。
        </p>
      </section>
    </div>
  );
}
