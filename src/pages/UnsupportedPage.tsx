export function UnsupportedPage({ reasons }: { reasons: string[] }) {
  return (
    <div className="page">
      <header className="home-header">
        <h1>大礼拜计数</h1>
      </header>
      <div className="panel">
        <p>当前环境无法使用本应用：</p>
        <ul>
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        <p className="hint">
          请使用支持摄像头与 WebGL2 的现代浏览器（Android Chrome / iOS Safari ≥ 16.4），
          并通过 HTTPS 或 localhost 访问。
        </p>
      </div>
    </div>
  );
}
