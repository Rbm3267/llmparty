import React, { useState, useEffect, useRef } from 'react';

const SOURCES = [
  { id: 'gateway',    label: 'Gateway',     color: '#e879f9' },
  { id: 'lmstudio',   label: 'LM Studio',   color: '#4ade80' },
  { id: 'claudecode', label: 'Claude Code',  color: '#22d3ee' },
];

function colorize(line) {
  if (!line) return null;
  let color = 'var(--text-secondary)';
  if (/error|fail|ERR|FATAL/i.test(line))   color = '#f43f5e';
  else if (/warn|WARN/i.test(line))          color = '#f59e0b';
  else if (/info|INFO|success|OK/i.test(line)) color = '#10b981';
  else if (/debug|DEBUG/i.test(line))        color = '#94a3b8';
  return color;
}

export default function Logs({ triggerToast }) {
  const [source, setSource] = useState('gateway');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef(null);

  const fetch_ = async () => {
    try {
      const logs = window.electronAPI?.getLogs
        ? await window.electronAPI.getLogs(source, 100)
        : await fetch(`/api/logs?service=${source}`).then(r => r.text());
      setText(logs || '');
    } catch (e) {
      setText(`Error: ${e.message}`);
    }
  };

  useEffect(() => { fetch_(); const t = setInterval(fetch_, 3000); return () => clearInterval(t); }, [source]);
  useEffect(() => { if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [text]);

  const lines = (filter
    ? text.split('\n').filter(l => l.toLowerCase().includes(filter.toLowerCase()))
    : text.split('\n')
  );

  const copy = () => { navigator.clipboard.writeText(text); triggerToast('Logs copied'); };

  return (
    <div className="fade-in col gap-4" style={{ height: 'calc(100vh - 140px)' }}>
      {/* Controls */}
      <div className="row sb">
        <div className="row gap-2">
          {SOURCES.map(s => (
            <button
              key={s.id}
              className={`btn btn-sm ${source === s.id ? 'btn-primary' : 'btn-ghost'}`}
              style={source === s.id ? { background: s.color, color: '#0d1117' } : {}}
              onClick={() => setSource(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="row gap-2">
          <input
            className="field-input"
            style={{ width: 200, padding: '6px 10px', fontSize: 12 }}
            placeholder="Filter lines…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button
            className={`btn btn-sm ${autoScroll ? 'btn-success' : 'btn-ghost'}`}
            onClick={() => setAutoScroll(p => !p)}
            title="Toggle auto-scroll"
          >
            {autoScroll ? '⬇ Live' : '⏸ Paused'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={fetch_}>↻ Refresh</button>
          <button className="btn btn-ghost btn-sm" onClick={copy}>⎘ Copy</button>
        </div>
      </div>

      {/* Log Viewer */}
      <div className="card" style={{ flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="dot-online pulse" style={{ '--dot-color': SOURCES.find(s => s.id === source)?.color }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}>
            {SOURCES.find(s => s.id === source)?.label} — {lines.length} lines
          </span>
          {filter && <span className="tag tag-amber">filter: {filter}</span>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', fontFamily: 'JetBrains Mono', fontSize: 12, lineHeight: 1.8 }}>
          {lines.length === 0 || (lines.length === 1 && !lines[0]) ? (
            <div className="empty-state">
              <span className="empty-icon">≡</span>
              <span className="empty-text">No log output yet</span>
            </div>
          ) : (
            lines.map((line, i) => (
              <div key={i} style={{ color: colorize(line), wordBreak: 'break-all', borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: 2 }}>
                <span style={{ color: 'var(--text-muted)', marginRight: 12, userSelect: 'none', fontSize: 10 }}>
                  {String(i + 1).padStart(4, ' ')}
                </span>
                {line || '\u00a0'}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
