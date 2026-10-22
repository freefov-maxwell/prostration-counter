// 生成 README 示意动画（SMIL，GitHub <img> 内可播放）：node scripts/gen-readme-demo.mjs docs/demo.svg
import { writeFileSync } from 'node:fs';

const T = 15; // 4 拜 × 3s + 3s 圆满停留
const out = process.argv[2];
const f = (t) => +(t / T).toFixed(4);

// 姿态：肩、髋、膝、脚、肘、手、头（侧视，面朝右边的手机）
const P = {
  A: { sh: [230, 172], hip: [230, 240], knee: [230, 285], foot: [230, 330], el: [233, 206], hand: [236, 240], head: [230, 152] },
  B: { sh: [290, 262], hip: [228, 282], knee: [236, 328], foot: [188, 328], el: [308, 296], hand: [320, 328], head: [308, 246] },
  C: { sh: [328, 320], hip: [264, 322], knee: [218, 324], foot: [172, 326], el: [370, 321], hand: [408, 321], head: [348, 314] },
};
const path = (p) => `M${p.sh} L${p.hip} L${p.knee} L${p.foot} M${p.sh} L${p.el} L${p.hand}`;

const keys = [];
for (let r = 0; r < 4; r++) {
  const b = r * 3;
  keys.push([b, 'A'], [b + 0.4, 'A'], [b + 1.0, 'B'], [b + 1.5, 'C'], [b + 2.1, 'C'], [b + 2.5, 'B'], [b + 2.95, 'A']);
}
keys.push([T, 'A']);
const kt = keys.map(([t]) => f(t)).join(';');
const splines = keys.slice(1).map(() => '0.45 0 0.55 1').join(';');
const anim = (attr, vals) =>
  `<animate attributeName="${attr}" dur="${T}s" repeatCount="indefinite" calcMode="spline" keyTimes="${kt}" keySplines="${splines}" values="${vals.join(';')}"/>`;

// 计数窗口：第 k 段显示 104+k，起身回站立瞬间 +1
const edges = [0, 2.95, 5.95, 8.95, 11.95, T];
const win = (k, on = 1, off = 0) => {
  const a = edges[k], b = edges[k + 1];
  const vals = [], times = [];
  if (a > 0) vals.push(off), times.push(0);
  vals.push(on), times.push(f(a));
  if (b < T) vals.push(off), times.push(f(b));
  return `<animate attributeName="opacity" dur="${T}s" repeatCount="indefinite" calcMode="discrete" keyTimes="${times.join(';')}" values="${vals.join(';')}"/>`;
};

// 相位文字（每拜内）
const phases = [
  ['站立', 0, 0.7],
  ['下拜', 0.7, 1.5],
  ['五体投地', 1.5, 2.5],
  ['起身', 2.5, 2.95],
];
const phaseAnim = (s, e) => {
  const vals = [0], times = [0];
  for (let r = 0; r < 4; r++) {
    const b = r * 3;
    vals.push(1, 0), times.push(f(b + s), f(b + e));
  }
  if (times[1] === 0) times.shift(), vals.shift();
  return `<animate attributeName="opacity" dur="${T}s" repeatCount="indefinite" calcMode="discrete" keyTimes="${times.join(';')}" values="${vals.join(';')}"/>`;
};

// 俯地/起身阶段手机屏边缘光晕（"已识别下拜"）
const glowK = [0], glowV = [0];
for (let r = 0; r < 4; r++) {
  const b = r * 3;
  glowK.push(f(b + 1.3), f(b + 1.55), f(b + 2.85), f(b + 3.0));
  glowV.push(0, 1, 1, 0);
}
glowK.push(1), glowV.push(0);

const C = 2 * Math.PI * 70;
const chars = '道可道非常道名';
const cx0 = 650 - ((chars.length - 1) * 22) / 2;

let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 420" width="800" height="420" font-family="'Noto Serif SC','Songti SC','SimSun',serif">
<title>大礼拜计数：前置摄像头识别动作，每拜自动 +1，并推进《道德经》一个字</title>
<defs>
  <radialGradient id="glow" cx="50%" cy="50%" r="70%"><stop offset="60%" stop-color="#f0a830" stop-opacity="0"/><stop offset="100%" stop-color="#f0a830" stop-opacity="0.9"/></radialGradient>
  <clipPath id="screen"><rect x="556" y="42" width="188" height="336" rx="18"/></clipPath>
</defs>
<rect width="800" height="420" rx="20" fill="#f5f1e8"/>

<!-- 场景 -->
<line x1="40" y1="331" x2="500" y2="331" stroke="#ddd4c3" stroke-width="3" stroke-linecap="round"/>
<g transform="rotate(10 446 331)"><rect x="440" y="263" width="12" height="68" rx="3" fill="#2b2620"/><circle cx="446" cy="271" r="2.2" fill="#9e2b25"/></g>
<path d="M456 272 L60 70 L60 331 Z" fill="#f0a830" opacity="0.07"/>
<text x="458" y="250" text-anchor="middle" font-size="14" fill="#6b6157">手机</text>
<g fill="none" stroke="#2b2620" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
  <path d="${path(P.A)}">${anim('d', keys.map(([, k]) => path(P[k])))}</path>
</g>
<circle r="14" fill="#f5f1e8" stroke="#2b2620" stroke-width="6" cx="${P.A.head[0]}" cy="${P.A.head[1]}">${anim('cx', keys.map(([, k]) => P[k].head[0]))}${anim('cy', keys.map(([, k]) => P[k].head[1]))}</circle>
`;
phases.forEach(([label, s, e]) => {
  svg += `<text x="60" y="64" font-size="22" fill="#2b2620" opacity="0">${label}${phaseAnim(s, e)}</text>\n`;
});
svg += `<text x="60" y="64" font-size="22" fill="#9e2b25" opacity="0">圆满 108 拜${win(4)}</text>
<text x="60" y="390" font-size="16" fill="#6b6157">你只管拜，它来数</text>

<!-- 手机屏幕 -->
<rect x="546" y="30" width="208" height="360" rx="28" fill="#2b2620"/>
<g clip-path="url(#screen)">
  <rect x="556" y="42" width="188" height="336" fill="#1c1916"/>
  <rect x="556" y="42" width="188" height="336" fill="url(#glow)" opacity="0"><animate attributeName="opacity" dur="${T}s" repeatCount="indefinite" keyTimes="${glowK.join(';')}" values="${glowV.join(';')}"/></rect>
  <circle cx="650" cy="150" r="70" fill="none" stroke="#ffffff" stroke-opacity="0.15" stroke-width="8"/>
`;
for (let k = 0; k < 5; k++) {
  const n = 104 + k;
  svg += `  <g opacity="${k === 0 ? 1 : 0}">${win(k)}
    <circle cx="650" cy="150" r="70" fill="none" stroke="#f0a830" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - n / 108)).toFixed(1)}" transform="rotate(-90 650 150)"/>
    <text x="650" y="168" text-anchor="middle" font-size="52" font-weight="700" fill="#ffffff">${n}</text>
  </g>\n`;
}
for (let k = 1; k <= 4; k++) {
  const t = edges[k];
  svg += `  <text x="700" y="110" font-size="20" font-weight="700" fill="#f0a830" opacity="0">+1<animate attributeName="opacity" dur="${T}s" repeatCount="indefinite" keyTimes="0;${f(t)};${f(t + 0.1)};${f(t + 0.9)};1" values="0;0;1;0;0"/><animateTransform attributeName="transform" type="translate" dur="${T}s" repeatCount="indefinite" keyTimes="0;${f(t)};${f(t + 0.9)};1" values="0 0;0 0;0 -24;0 -24"/></text>\n`;
}
svg += `  <text x="650" y="196" text-anchor="middle" font-size="13" fill="#ffffff" fill-opacity="0.6">目标 108</text>
  <g opacity="0">${win(4)}<rect x="605" y="242" width="90" height="26" rx="13" fill="#f0a830"/><text x="650" y="260" text-anchor="middle" font-size="14" fill="#2b2620">目标已达成</text></g>
`;
[...chars].forEach((ch, i) => {
  const x = cx0 + i * 22;
  const dim = i < 5 ? `${win(i, 0, 1)}` : '';
  svg += `  <text x="${x}" y="318" text-anchor="middle" font-size="18" fill="#ffffff" fill-opacity="0.45">${ch}${dim}</text>\n`;
  if (i < 5) svg += `  <text x="${x}" y="322" text-anchor="middle" font-size="28" font-weight="700" fill="#ffd9a0" opacity="${i === 0 ? 1 : 0}">${ch}${win(i)}</text>\n`;
});
svg += `  <text x="650" y="356" text-anchor="middle" font-size="12" fill="#ffffff" fill-opacity="0.45">《道德经》每拜一字</text>
</g>
<text x="650" y="410" text-anchor="middle" font-size="14" fill="#6b6157">手机屏幕</text>
</svg>
`;
writeFileSync(out, svg);
console.log('wrote', out, svg.length, 'bytes');
