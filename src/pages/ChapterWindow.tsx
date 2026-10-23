import { useLayoutEffect, useRef, useState } from "react";
import { scripture } from "../scripture";

const ROWS = 3;

/** 当前字所在章原文，只露 3 行：当前字所在行居中（章首、章末除外），换行时整体上移一行。
 *  按实际排版测量行号，任意屏宽通用；行高取自 CSS 变量 --lh。 */
export function ChapterWindow({
  index,
  className,
}: {
  index: number;
  className?: string;
}) {
  const chapter = scripture.chapterOf(index);
  const textRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLSpanElement>(null);
  const [top, setTop] = useState(0);

  useLayoutEffect(() => {
    const text = textRef.current;
    const cur = curRef.current;
    if (!text || !cur) return;
    const lh = parseFloat(getComputedStyle(text).lineHeight);
    const line = Math.round(cur.offsetTop / lh);
    const total = Math.round(text.scrollHeight / lh);
    setTop(Math.max(0, Math.min(line - 1, total - ROWS)) * lh);
  }, [index]);

  return (
    <div className={className}>
      <div className="chapter-window">
        {/* 换章时重新挂载，避免从上一章的位置滑过来 */}
        <div
          key={chapter}
          ref={textRef}
          className="chapter-window-text"
          style={{ transform: `translateY(${-top}px)` }}
        >
          {scripture.chapterTokens[chapter - 1].map((t, k) =>
            t.i === index ? (
              <span key={k} ref={curRef} className="chapter-window-current">
                {t.c}
              </span>
            ) : (
              t.c
            ),
          )}
        </div>
      </div>
    </div>
  );
}
