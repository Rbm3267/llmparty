import React, { useState, useEffect, useRef } from 'react';
import { CircularProgress } from '@mui/material';

const PROVIDER_META = {
  anthropic:        { name: 'Anthropic (API Key)',   color: '#2dd4bf', icon: '◆', cls: 'pb-anthropic',   placeholder: 'claude-sonnet-4-6',      hint: 'api.anthropic.com · personal key' },
  claude_enterprise:{ name: 'Claude Enterprise',    color: '#e879f9', icon: '★', cls: 'pb-enterprise',  placeholder: 'claude-sonnet-4-6',      hint: 'claude --print · no API key' },
  openai:           { name: 'OpenAI GPT',            color: '#93c5fd', icon: '○', cls: 'pb-openai',     placeholder: 'gpt-4o',                 hint: 'api.openai.com' },
  gemini:           { name: 'Google Gemini',         color: '#d8b4fe', icon: '◇', cls: 'pb-gemini',     placeholder: 'gemini-2.5-flash',       hint: 'generativelanguage.googleapis.com' },
  local:            { name: 'Local Model',           color: '#fbbf24', icon: '◎', cls: 'pb-local',      placeholder: 'qwen2.5-7b-instruct-mlx', hint: 'localhost:1234/v1' },
};

export default function Configuration({ configs, onSaveConfigs, triggerToast }) {
  const [form, setForm]   = useState({ tui: {}, backends: {} });
  const [testing, setTesting] = useState(null);
  const [dirty, setDirty] = useState(false);

  // Drag state
  const dragIdx    = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  useEffect(() => {
    if (configs?.backends) { setForm(configs); setDirty(false); }
  }, [configs]);

  // ── Generic setter ──────────────────────────────
  const set = (path, val) => {
    setForm(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let cur = copy;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!cur[keys[i]]) cur[keys[i]] = {};
        cur = cur[keys[i]];
      }
      cur[keys[keys.length - 1]] = val;
      return copy;
    });
    setDirty(true);
  };

  // ── Pipeline helpers ────────────────────────────
  const pipeline = form.backends?.pipeline || ['anthropic', 'gemini', 'local'];

  const setPipeline = (newOrder) => {
    setForm(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      copy.backends.pipeline = newOrder;
      // Auto-sync primary to the first in the new order
      copy.backends.primary = newOrder[0];
      return copy;
    });
    setDirty(true);
  };

  const moveUp   = (i) => { if (i === 0) return; const o = [...pipeline]; [o[i-1], o[i]] = [o[i], o[i-1]]; setPipeline(o); };
  const moveDown = (i) => { if (i === pipeline.length - 1) return; const o = [...pipeline]; [o[i], o[i+1]] = [o[i+1], o[i]]; setPipeline(o); };
  const setPrimary = (id) => {
    const o = [id, ...pipeline.filter(p => p !== id)];
    setPipeline(o);
  };

  // ── Drag & Drop handlers ────────────────────────
  const onDragStart = (e, i) => {
    dragIdx.current = i;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragEnter = (i) => { if (dragIdx.current !== i) setDragOver(i); };
  const onDragOver  = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const onDrop      = (e, i) => {
    e.preventDefault();
    const from = dragIdx.current;
    if (from === null || from === i) { setDragOver(null); return; }
    const o = [...pipeline];
    const [moved] = o.splice(from, 1);
    o.splice(i, 0, moved);
    setPipeline(o);
    dragIdx.current = null;
    setDragOver(null);
  };
  const onDragEnd = () => { dragIdx.current = null; setDragOver(null); };

  // ── Connection test ─────────────────────────────
  const test = async (provider) => {
    setTesting(provider);
    try {
      const res = await fetch('/api/models/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model:    form.backends[provider]?.model    || '',
          api_key:  form.backends[provider]?.api_key  || '',
          base_url: form.backends[provider]?.base_url || '',
        })
      });
      const d = await res.json();
      if (d.success) triggerToast(`✓ ${provider} connection OK`);
      else triggerToast(`✗ ${provider}: ${d.error || 'HTTP ' + d.statusCode}`);
    } catch (e) { triggerToast(`✗ ${e.message}`); }
    finally { setTesting(null); }
  };

  const save = () => { onSaveConfigs(form); setDirty(false); triggerToast('Configuration saved'); };

  // Add / remove a provider from the pipeline
  const toggleInPipeline = (id) => {
    const current = form.backends?.pipeline || [];
    const newOrder = current.includes(id)
      ? current.filter(p => p !== id)
      : [...current, id];
    if (newOrder.length === 0) { triggerToast('Pipeline must have at least one provider'); return; }
    setForm(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      copy.backends.pipeline = newOrder;
      if (!newOrder.includes(copy.backends.primary)) copy.backends.primary = newOrder[0];
      return copy;
    });
    setDirty(true);
  };

  return (
    <div className="fade-in col gap-5">

      {/* ── Header ─────────────────────────────────── */}
      <div className="row sb">
        <div>
          <div className="section-title">Integrations & Configuration</div>
          <div className="section-sub">Drag providers to set failover order · First position = primary</div>
        </div>
        <button className="btn btn-primary btn-lg" onClick={save} disabled={!dirty}>
          {dirty ? '⬆ Save Changes' : '✓ Saved'}
        </button>
      </div>

      {/* ── Pipeline Drag & Drop ────────────────────── */}
      <div className="card">
        <div className="row sb mb-3">
          <div>
            <div className="card-title" style={{ marginBottom: 2 }}>Failover Pipeline</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Drag to reorder · The gateway tries each provider in sequence on failure
            </div>
          </div>
          <span className="tag tag-primary">{pipeline.length} providers</span>
        </div>

        <div className="col gap-2">
          {pipeline.map((id, i) => {
            const meta = PROVIDER_META[id] || { name: id, color: '#94a3b8', icon: '◉', cls: '', placeholder: '', hint: '' };
            const isPrimary = i === 0;
            const isDraggingOver = dragOver === i;
            return (
              <div
                key={id}
                draggable
                onDragStart={e => onDragStart(e, i)}
                onDragEnter={() => onDragEnter(i)}
                onDragOver={onDragOver}
                onDrop={e => onDrop(e, i)}
                onDragEnd={onDragEnd}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid',
                  borderColor: isDraggingOver
                    ? meta.color
                    : isPrimary
                    ? `${meta.color}55`
                    : 'var(--border)',
                  background: isDraggingOver
                    ? `${meta.color}18`
                    : isPrimary
                    ? `${meta.color}08`
                    : 'var(--bg-surface)',
                  cursor: 'grab',
                  transition: 'all 0.15s ease',
                  transform: isDraggingOver ? 'scale(1.01)' : 'scale(1)',
                  boxShadow: isDraggingOver ? `0 4px 20px ${meta.color}30` : 'none',
                  userSelect: 'none',
                }}
              >
                {/* Drag handle */}
                <div style={{ color: 'var(--text-muted)', fontSize: 14, cursor: 'grab', flexShrink: 0, lineHeight: 1 }}>
                  ⠿
                </div>

                {/* Position badge */}
                <div style={{
                  width: 26, height: 26, borderRadius: 6,
                  background: isPrimary ? meta.color : 'var(--bg-overlay)',
                  color: isPrimary ? '#0d1117' : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800, flexShrink: 0,
                  fontFamily: 'JetBrains Mono',
                }}>
                  {i + 1}
                </div>

                {/* Provider info */}
                <div style={{ flex: 1 }}>
                  <div className="row gap-2" style={{ marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{meta.name}</span>
                    {isPrimary && <span className="tag tag-amber">PRIMARY</span>}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {form.backends?.[id]?.model || meta.placeholder} · {meta.hint}
                  </div>
                </div>

                {/* Status dot */}
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: form.backends?.[id]?.api_key || id === 'local' ? '#10b981' : '#475569',
                  boxShadow: (form.backends?.[id]?.api_key || id === 'local') ? '0 0 6px #10b981' : 'none',
                }} />

                {/* Controls */}
                <div className="row gap-1" style={{ flexShrink: 0 }}>
                  {!isPrimary && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPrimary(id)}
                      title="Set as primary"
                      style={{ fontSize: 10, padding: '4px 8px' }}
                    >
                      ★ Set Primary
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    title="Move up"
                    style={{ padding: '4px 8px', opacity: i === 0 ? 0.3 : 1 }}
                  >
                    ↑
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => moveDown(i)}
                    disabled={i === pipeline.length - 1}
                    title="Move down"
                    style={{ padding: '4px 8px', opacity: i === pipeline.length - 1 ? 0.3 : 1 }}
                  >
                    ↓
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Flow diagram */}
        <div className="row gap-0" style={{ marginTop: 16, overflowX: 'auto', paddingBottom: 4 }}>
          {pipeline.map((id, i) => {
            const meta = PROVIDER_META[id] || { name: id, color: '#94a3b8', icon: '◉' };
            return (
              <React.Fragment key={id}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: `${meta.color}15`, border: `1px solid ${meta.color}40`,
                    color: meta.color, whiteSpace: 'nowrap',
                  }}>
                    {meta.icon} {id}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {i === 0 ? 'primary' : `fallback ${i}`}
                  </div>
                </div>
                {i < pipeline.length - 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px', marginTop: -10 }}>
                    <div style={{ width: 24, height: 1, background: 'var(--border-bright)' }} />
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 2px' }}>on fail →</div>
                    <div style={{ width: 24, height: 1, background: 'var(--border-bright)' }} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── Provider Toggles ─────────────────────────────────────────── */}
      <div className="card">
        <div className="row sb mb-3">
          <div>
            <div className="card-title" style={{ marginBottom: 2 }}>Available Providers</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Click to add or remove from the pipeline above</div>
          </div>
        </div>
        <div className="row gap-2 wrap">
          {Object.entries(PROVIDER_META).map(([id, meta]) => {
            const inPipeline = pipeline.includes(id);
            return (
              <button
                key={id}
                onClick={() => toggleInPipeline(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', borderRadius: 8, cursor: 'pointer', border: '1px solid',
                  background: inPipeline ? `${meta.color}12` : 'var(--bg-surface)',
                  borderColor: inPipeline ? `${meta.color}50` : 'var(--border)',
                  color: inPipeline ? meta.color : 'var(--text-muted)',
                  fontWeight: 600, fontSize: 12, fontFamily: 'Inter',
                  transition: 'all 0.15s ease',
                  boxShadow: inPipeline ? `0 0 10px ${meta.color}20` : 'none',
                }}
              >
                <span style={{ fontSize: 14 }}>{meta.icon}</span>
                <span>{meta.name}</span>
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 4,
                  background: inPipeline ? `${meta.color}25` : 'rgba(255,255,255,0.05)',
                  color: inPipeline ? meta.color : 'var(--text-muted)',
                  fontWeight: 700,
                }}>
                  {inPipeline ? `#${pipeline.indexOf(id) + 1}` : '+ add'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── API Credentials ─────────────────────────────────────────── */}
      <div className="col gap-3">
        {Object.keys(PROVIDER_META).filter(id => id !== 'local' && pipeline.includes(id)).map(id => {
          const meta = PROVIDER_META[id];

          // claude_enterprise — no key needed, show status card
          if (id === 'claude_enterprise') {
            return (
              <div key={id} className="card" style={{ borderColor: 'rgba(232,121,249,0.2)', background: 'rgba(232,121,249,0.03)' }}>
                <div className="row sb mb-3">
                  <div className="row gap-3">
                    <span className="provider-badge pb-enterprise">enterprise</span>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14, color: meta.color }}>{meta.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                        #{pipeline.indexOf(id) + 1} in pipeline · <span className="mono">claude --print</span>
                      </span>
                    </div>
                  </div>
                  <span className="tag tag-primary">● No Key Required</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="field-group">
                    <label className="field-label">CLI Binary</label>
                    <div className="field-input mono" style={{ color: 'var(--text-muted)', cursor: 'default', fontSize: 12 }}>
                      ~/.local/bin/claude
                    </div>
                  </div>
                  <div className="field-group">
                    <label className="field-label">Default Model (hint only)</label>
                    <input
                      className="field-input"
                      value={form.backends?.claude_enterprise?.model || ''}
                      onChange={e => set('backends.claude_enterprise.model', e.target.value)}
                      placeholder="claude-sonnet-4-6"
                    />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
                  Authenticated via <span className="mono" style={{ color: meta.color }}>claude auth</span> (enterprise SSO).
                  Cost billed to your enterprise plan — $0 API spend.
                  Run <span className="mono" style={{ color: meta.color }}>claude auth</span> in your terminal to re-authenticate.
                </p>
              </div>
            );
          }

          // Standard API key provider
          const hasKey = !!form.backends?.[id]?.api_key;
          return (
            <div key={id} className="card">
              <div className="row sb mb-3">
                <div className="row gap-3">
                  <span className={`provider-badge ${meta.cls}`}>{id}</span>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 14, color: meta.color }}>{meta.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                      #{pipeline.indexOf(id) + 1} in pipeline
                    </span>
                  </div>
                </div>
                <div className="row gap-2">
                  <span className={`tag ${hasKey ? 'tag-green' : 'tag-red'}`}>
                    {hasKey ? '● Key Set' : '○ No Key'}
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => test(id)} disabled={!!testing}>
                    {testing === id
                      ? <><CircularProgress size={10} style={{ color: 'inherit' }} /> Testing…</>
                      : '⚡ Test'}
                  </button>
                </div>
              </div>
              <div className="row gap-3">
                <div className="field-group" style={{ flex: 2 }}>
                  <label className="field-label">API Key</label>
                  <input
                    type="password"
                    className="field-input"
                    value={form.backends?.[id]?.api_key || ''}
                    onChange={e => set(`backends.${id}.api_key`, e.target.value)}
                    placeholder="sk-…"
                  />
                </div>
                <div className="field-group" style={{ flex: 2 }}>
                  <label className="field-label">Default Model</label>
                  <input
                    className="field-input"
                    value={form.backends?.[id]?.model || ''}
                    onChange={e => set(`backends.${id}.model`, e.target.value)}
                    placeholder={meta.placeholder}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Local Backend ───────────────────────────── */}
      <div className="card">
        <div className="row sb mb-3">
          <div className="row gap-3">
            <span className="provider-badge pb-local">local</span>
            <div>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#f59e0b' }}>Local Inference Endpoint</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                #{pipeline.indexOf('local') + 1 || '—'} in pipeline
              </span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => test('local')} disabled={!!testing}>
            {testing === 'local' ? <><CircularProgress size={10} style={{ color: 'inherit' }} /> Testing…</> : '⚡ Test'}
          </button>
        </div>
        <div className="row gap-3">
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Base URL</label>
            <input
              className="field-input"
              value={form.backends?.local?.base_url || ''}
              onChange={e => set('backends.local.base_url', e.target.value)}
              placeholder="http://localhost:1234/v1"
            />
          </div>
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Model Tag</label>
            <input
              className="field-input"
              value={form.backends?.local?.model || ''}
              onChange={e => set('backends.local.model', e.target.value)}
              placeholder="qwen2.5-7b-instruct-mlx"
            />
          </div>
        </div>
      </div>

      {/* ── TUI Config ──────────────────────────────── */}
      <div className="card">
        <div className="card-title">Terminal UI Settings</div>
        <div className="row gap-3">
          <div className="field-group" style={{ flex: 1 }}>
            <label className="field-label">Theme</label>
            <select className="field-input" value={form.tui?.theme || 'party'} onChange={e => set('tui.theme', e.target.value)}>
              <option value="party">Party (Rainbow)</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="matrix">Matrix</option>
            </select>
          </div>
          <div className="field-group" style={{ flex: 3 }}>
            <label className="field-label">Status Bar Format</label>
            <input
              className="field-input"
              value={form.tui?.status_bar_format || ''}
              onChange={e => set('tui.status_bar_format', e.target.value)}
              placeholder="{status} {provider} ({model}) | Context: {context} | Cost: ${cost}"
            />
          </div>
        </div>
      </div>

      {/* ── MCP Plugins ──────────────────────────────── */}
      <div className="card">
        <div className="card-title">MCP Plugins</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: '16px' }}>
          Configure Model Context Protocol servers to provide custom tools and context.
        </div>
        <div className="col gap-3">
          {Object.entries(form.mcpServers || {}).map(([name, mcp], idx) => (
            <div key={idx} className="row gap-3 wrap" style={{ padding: '12px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px' }}>
              <div className="field-group" style={{ flex: 1, minWidth: '150px' }}>
                <label className="field-label">Name</label>
                <input className="field-input" value={name} disabled />
              </div>
              <div className="field-group" style={{ flex: 1, minWidth: '150px' }}>
                <label className="field-label">Command</label>
                <input className="field-input" value={mcp.command || ''} onChange={e => set(`mcpServers.${name}.command`, e.target.value)} />
              </div>
              <div className="field-group" style={{ flex: 2, minWidth: '200px' }}>
                <label className="field-label">Arguments (comma separated)</label>
                <input className="field-input" value={(mcp.args || []).join(', ')} onChange={e => set(`mcpServers.${name}.args`, e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} />
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                setForm(prev => {
                  const copy = JSON.parse(JSON.stringify(prev));
                  delete copy.mcpServers[name];
                  return copy;
                });
                setDirty(true);
              }} style={{ color: '#ff5f56', marginTop: '24px' }}>
                🗑
              </button>
            </div>
          ))}
          <div className="row gap-2 mt-2">
            <button className="btn btn-ghost btn-sm" onClick={() => {
              const newName = prompt('Enter new MCP server name:');
              if (newName && !form.mcpServers?.[newName]) {
                set(`mcpServers.${newName}`, { command: 'node', args: [], env: {} });
              }
            }}>
              + Add MCP Server
            </button>
          </div>
        </div>
      </div>

      {/* ── Save footer ─────────────────────────────── */}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary btn-lg" onClick={save} disabled={!dirty}>
          {dirty ? '⬆ Save All Changes' : '✓ All Saved'}
        </button>
      </div>
    </div>
  );
}
