# 大礼拜计数（dalibai）

手机浏览器 PWA：前置摄像头本地运行 BlazePose 姿态识别，自动为大礼拜（磕大头）计数；每拜推进《道德经》逐字显示。纯前端、无后端，视频不出设备，数据仅存本机（IndexedDB），无任何外联请求与埋点。

## 技术栈

React 18 + TypeScript + Vite 5 + zustand + dexie + @mediapipe/tasks-vision（PoseLandmarker lite）+ vite-plugin-pwa + vitest。

## 常用命令

```bash
npm install        # 安装依赖（postinstall 自动复制 MediaPipe WASM 到 public/wasm/）
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建（输出 dist/，含 Service Worker）
npm run preview    # 预览生产构建
npm test           # vitest 单测（状态机回放 / 信号提取 / 经书预处理 / 统计）
npm run icons      # 重新生成 PWA 图标（scripts/gen-icons.mjs，零依赖手工编码 PNG）
```

## 摄像头调试

getUserMedia 要求安全上下文：请用 **localhost** 或 **HTTPS** 访问。真机调试可用
`vite --host` 加自签证书，或通过端口转发（如 `adb reverse`）走 localhost。

## 架构要点

- `src/engine/`：识别引擎（SignalExtractor / RepStateMachine / 碰撞预判），
  纯 TypeScript、无 DOM/MediaPipe 依赖，可单测，二期小程序直接复用。
- `src/platform/`：相机、PoseLandmarker、声音/震动等平台适配层。
- `src/store/`：zustand 应用状态（页面枚举导航，无 react-router）。
- `src/db/`：Dexie 三个表（sessions / scriptureProgress / settings）。

### v1 决策注记：主线程推理

技术文档 §1.3 的优先方案是 Web Worker 推理；v1 采用既定的**降级方案**——
主线程推理 +「上一帧未完成则丢弃新帧」的背压策略（见 `src/platform/pose.ts` 的
`PoseDetector`）。理由：v1 优先交付完整功能闭环，lite 模型 + 背压丢帧在中端机上
可维持有效计数帧率；Worker 方案待 M0 真机实测帧率后再评估是否迁移。

## PWA

manifest 中文名「大礼拜计数」、standalone、竖屏锁定；Service Worker 预缓存全部
构建产物 + WASM + 姿态模型（约 39MB，单文件上限放宽到 12MB），首次加载后离线可用。

## 已知限制

- 切后台/熄屏后相机与计时会中断，回前台提示「会话已中断，是否继续」（PWA 平台限制）。
- 正面摆放下俯地阶段骨架不完整是设计内场景：计数锚定在回到稳定站立，俯地阶段
  靠 PARTIAL/LOST 帧的多信号推断。
- iOS 无 Vibration API，震动反馈静默跳过；音频需在用户手势中初始化。
