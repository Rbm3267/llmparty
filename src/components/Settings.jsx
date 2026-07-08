import React, { useState, useEffect } from 'react';

export default function Settings({ triggerToast }) {
  const [sysInfo, setSysInfo] = useState(null);
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const info = window.electronAPI?.getSystemInfo
          ? await window.electronAPI.getSystemInfo()
          : await fetch('/api/sysinfo').then(r => r.json());
        setSysInfo(info);
      } catch (e) { /* ignore */ }
    };
    fetchInfo();
    // Uptime ticker
    const t = setInterval(() => setUptime(p => p + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const reset = async () => {
    if (!confirm('Reset LLMParty configuration to defaults? API keys will be cleared.')) return;
    try {
      await fetch('/api/configs/reset', { method: 'POST' });
      triggerToast('Configuration reset');
    } catch (e) { triggerToast('Reset failed: ' + e.message); }
  };

  const formatUptime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  return (
    <div className="fade-in col gap-5">
      <div>
        <div className="section-title">System Information</div>
        <div className="section-sub">Hardware details, runtime info, and maintenance tools</div>
      </div>

      {/* Runtime */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <InfoCard label="Gateway Uptime" value={formatUptime(uptime)} accent="amber" mono />
        <InfoCard label="Proxy Port"     value=":9990" accent="cyan" mono />
        <InfoCard label="Gateway"        value="Active" accent="emerald" dot />
      </div>

      {/* Enterprise Claude */}
      <div className="card" style={{ borderColor: 'rgba(232,121,249,0.2)', background: 'rgba(232,121,249,0.03)' }}>
        <div className="row sb mb-3">
          <div>
            <div className="card-title" style={{ color: 'var(--accent-primary)', marginBottom: 2 }}>Enterprise Claude</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>via <span className="mono">claude --print</span> subprocess · no API key required</div>
          </div>
          <span className="tag tag-primary">● Active</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          {[
            ['CLI Path',    '~/.local/bin/claude'],
            ['Version',     '2.1.198 (Claude Code)'],
            ['Auth Method', 'Enterprise SSO / claude auth'],
            ['Cost',        '$0 — billed to enterprise plan'],
          ].map(([label, val]) => (
            <div key={label} style={{ padding: '10px 4px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{val}</span>
            </div>
          ))}
        </div>
        <div className="code-block mt-3" style={{ padding: '8px 12px', fontSize: 11 }}>
          {`# How to authenticate / re-authenticate\nclaude auth\n\n# Test enterprise routing through the gateway\ncurl http://localhost:9990/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"Hi"}]}'`}
        </div>
      </div>

      {/* Hardware Profile */}
      <div className="card">
        <div className="card-title">Hardware Profile</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          {sysInfo ? (
            [
              ['Operating System', `${sysInfo.platform || '—'} (${sysInfo.arch || '—'})`],
              ['CPU Cores',        sysInfo.cpus || '—'],
              ['Total Memory',     sysInfo.totalMemory || '—'],
              ['Free Memory',      sysInfo.freeMemory || '—'],
              ['CPU Load',         sysInfo.cpuPercentage != null ? `${sysInfo.cpuPercentage}%` : '—'],
              ['RAM Used',         sysInfo.ramPercentage != null ? `${sysInfo.ramPercentage}%` : '—'],
            ].map(([label, val]) => (
              <div key={label} style={{ padding: '12px 4px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-primary)' }}>{val}</span>
              </div>
            ))
          ) : (
            <div style={{ gridColumn: '1/-1', padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Loading hardware info…
            </div>
          )}
        </div>
      </div>

      {/* Gateway Config Info */}
      <div className="card">
        <div className="card-title">Gateway Integration</div>
        <div className="col gap-3">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Point any OpenAI-compatible client (Claude Code, Cursor, Continue.dev) at the gateway endpoint below.
            The gateway auto-routes to your configured provider — or through <code>claude -p</code> for enterprise access (no API key needed).
          </p>
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>OpenAI-Compatible Endpoint</div>
            <div className="code-block" style={{ padding: '10px 14px' }}>http://localhost:9990/v1</div>
          </div>
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>Example cURL Test</div>
            <div className="code-block" style={{ padding: '10px 14px' }}>
{`curl http://localhost:9990/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"Hi"}]}'`}
            </div>
          </div>
        </div>
      </div>

      {/* Links */}
      <div className="card">
        <div className="card-title">Resources & Docs</div>
        <div className="col gap-2">
          {[
            ['Anthropic Claude Docs', 'https://docs.anthropic.com'],
            ['Google Gemini API',     'https://ai.google.dev/docs'],
            ['Claude Code',           'https://github.com/anthropics/claude-code'],
            ['LM Studio Docs',        'https://lmstudio.ai/docs'],
            ['Continue.dev',          'https://continue.dev'],
          ].map(([label, url]) => (
            <a key={url} href={url} target="_blank" rel="noopener" style={{ fontSize: 13, color: 'var(--accent-amber)', textDecoration: 'none', padding: '8px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{label}</span>
              <span style={{ opacity: 0.5 }}>↗</span>
            </a>
          ))}
        </div>
      </div>

      {/* Danger zone */}
      <div className="card" style={{ borderColor: 'rgba(244,63,94,0.2)' }}>
        <div className="card-title" style={{ color: 'var(--accent-rose)' }}>Danger Zone</div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
          Resetting will clear all API keys and revert configuration to defaults. This does not affect your local models.
        </p>
        <button className="btn btn-danger" onClick={reset}>⚠ Reset Configuration</button>
      </div>

      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', paddingBottom: 8 }}>
        LLMParty Gateway · v1.0.0 · MIT License
      </div>
    </div>
  );
}

function InfoCard({ label, value, accent, mono, dot }) {
  const colors = { amber: '#f59e0b', cyan: '#06b6d4', emerald: '#10b981' };
  const color = colors[accent] || '#f0f4f8';
  return (
    <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div className="card-title">{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {dot && <span className="dot-online" />}
        <span className={mono ? 'mono' : ''} style={{ fontSize: 24, fontWeight: 800, color }}>{value}</span>
      </div>
    </div>
  );
}
