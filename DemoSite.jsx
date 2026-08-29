const layers = [
  { name: "Navigation", tag: "nav", depth: "01", tone: "mint" },
  { name: "Dashboard", tag: "main", depth: "02", tone: "cyan" },
  { name: "Telemetry", tag: "section", depth: "03", tone: "violet" },
  { name: "Inspector", tag: "aside", depth: "04", tone: "amber" },
];

const events = [
  ["Orbit established", "Camera", "just now"],
  ["Stacking context detected", "DOM", "12 sec"],
  ["Explosion exceeded reason", "Physics", "38 sec"],
  ["Another div joined the family", "DOM", "1 min"],
];

function Mark() {
  return <span className="demo-mark" aria-hidden="true">T</span>;
}

export function DemoSite() {
  return (
    <div className="demo-app" data-toretto-root="">
      <header className="demo-topbar" data-toretto-surface="">
        <div className="demo-title"><Mark /><strong>Toretto</strong><span>DOM telemetry</span></div>
        <div className="demo-top-actions">
          <button type="button">Capture frame</button>
          <span className="demo-status"><i />Scene live</span>
          <div className="demo-avatar">DOM</div>
        </div>
      </header>

      <nav className="demo-sidebar" aria-label="Demo navigation" data-toretto-surface="">
        <p className="demo-kicker">Workspace</p>
        {['Overview', 'Elements', 'Scenes', 'Sequences'].map((item, index) => (
          <button className={index === 0 ? "selected" : ""} type="button" key={item}>
            <span>{['⌂', '◇', '▣', '↝'][index]}</span>{item}<small>{[24, 186, 4, 12][index]}</small>
          </button>
        ))}
        <p className="demo-kicker">Tools</p>
        {['Timeline', 'Presets', 'Exports'].map((item, index) => (
          <button type="button" key={item}><span>{['⌁', '✦', '⇧'][index]}</span>{item}</button>
        ))}
        <div className="demo-sidebar-note" data-toretto-surface="">
          <strong>Quarter-mile view</strong>
          <span>Every element, one finish line.</span>
        </div>
      </nav>

      <main className="demo-main" data-toretto-scroll="">
        <section className="demo-heading">
          <div><p className="demo-kicker">Live scene</p><h1>DOM Overview</h1></div>
          <div className="demo-segment"><button className="selected" type="button">Structure</button><button type="button">Layers</button></div>
        </section>

        <section className="demo-metrics" aria-label="Scene metrics">
          {[
            ["Elements", "186", "+14"],
            ["Max depth", "12", "+3"],
            ["Stacking contexts", "9", "+1"],
            ["FPS", "60", "steady"],
          ].map(([label, value, delta]) => (
            <article className="demo-card demo-metric" data-toretto-surface="" key={label}>
              <span>{label}</span><strong>{value}</strong><small>{delta}</small>
            </article>
          ))}
        </section>

        <section className="demo-grid">
          <article className="demo-card demo-chart" data-toretto-surface="">
            <div className="demo-card-title"><div><span>Depth distribution</span><strong>Scene topology</strong></div><button type="button">•••</button></div>
            <div className="demo-bars" aria-label="Decorative depth chart">
              {[34, 58, 44, 78, 62, 91, 72, 54, 68, 42, 76, 88].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
            </div>
            <div className="demo-axis"><span>Root</span><span>Nested DOM</span><span>Deepest</span></div>
          </article>

          <article className="demo-card demo-layers" data-toretto-surface="">
            <div className="demo-card-title"><div><span>Scene graph</span><strong>Layer families</strong></div><button type="button">View all</button></div>
            {layers.map((layer) => (
              <div className="demo-layer" key={layer.name}>
                <i className={layer.tone}>{layer.depth}</i>
                <div><strong>{layer.name}</strong><span>&lt;{layer.tag}&gt;</span></div>
                <b>→</b>
              </div>
            ))}
          </article>
        </section>

        <section className="demo-card demo-activity" data-toretto-surface="">
          <div className="demo-card-title"><div><span>Recorder</span><strong>Recent activity</strong></div><button type="button">Clear</button></div>
          {events.map(([name, source, time]) => (
            <div className="demo-event" key={name}><i /><strong>{name}</strong><span>{source}</span><time>{time}</time></div>
          ))}
        </section>
      </main>

      <aside className="demo-inspector" data-toretto-surface="">
        <div className="demo-inspector-head"><div><p className="demo-kicker">Selection</p><h2>main.demo-main</h2></div><button type="button">×</button></div>
        <div className="demo-preview" data-toretto-surface=""><span>MAIN</span><i /><b>1440 × 900</b></div>
        <section><h3>Transform</h3>{[['Position', '0, 0, 0'], ['Rotation', '0°, 0°, 0°'], ['Scale', '1, 1, 1']].map(([key, value]) => <label key={key}><span>{key}</span><input value={value} readOnly /></label>)}</section>
        <section><h3>Computed</h3>{[['Display', 'grid'], ['Position', 'relative'], ['Z-index', 'auto'], ['Children', '5']].map(([key, value]) => <div className="demo-property" key={key}><span>{key}</span><code>{value}</code></div>)}</section>
        <blockquote>“I don't have friends. I have nested elements.”</blockquote>
      </aside>
    </div>
  );
}
