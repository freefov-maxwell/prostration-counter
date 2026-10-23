// 环境能力检测：无 getUserMedia 或 WebGL → 不支持页，不白屏。
// 默认的 MoveNet（TF.js）WebGL1 即可运行；MediaPipe 需 WebGL2，不满足时加载失败会提示。
export interface SupportResult {
  ok: boolean;
  reasons: string[];
}

export function checkSupport(): SupportResult {
  const reasons: string[] = [];
  if (!navigator.mediaDevices?.getUserMedia) {
    reasons.push('当前环境不支持摄像头访问（需要 HTTPS 或 localhost）');
  }
  const canvas = document.createElement('canvas');
  if (!canvas.getContext('webgl2') && !canvas.getContext('webgl')) {
    reasons.push('当前浏览器不支持 WebGL，无法运行姿态识别');
  }
  return { ok: reasons.length === 0, reasons };
}
