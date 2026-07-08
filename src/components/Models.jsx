import React, { useState, useEffect } from 'react';
import { CircularProgress } from '@mui/material';

export default function Models({ lmStudio, localModels, setLocalModels, triggerToast }) {
  const [fetchedModels, setFetchedModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [testingStatus, setTestingStatus] = useState(null);
  const [selectedProvider, setSelectedProvider] = useState('local');
  const [newModel, setNewModel] = useState({ provider: 'local', model: '', api_key: '', base_url: '' });

  const providerColors = {
    anthropic: '#00b5ad', openai: '#60a5fa', gemini: '#c084fc', local: '#f59e0b'
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/models?provider=${selectedProvider}`);
      const data = await res.json();
      setFetchedModels(data || []);
    } catch (e) {
      triggerToast('Failed to fetch models: ' + e.message);
    } finally { setLoading(false); }
  };

  const test = async () => {
    setTestingStatus('testing');
    try {
      const res = await fetch('/api/models/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newModel)
      });
      const d = await res.json();
      if (d.success) { triggerToast('✓ Connection successful'); setTestingStatus('ok'); }
      else { triggerToast(`✗ Failed: ${d.error || 'unknown'}`); setTestingStatus('fail'); }
    } catch (e) { triggerToast('✗ ' + e.message); setTestingStatus('fail'); }
    setTimeout(() => setTestingStatus(null), 2000);
  };

  useEffect(() => { refresh(); }, [selectedProvider]);

  const activeModel = lmStudio.activeModel && lmStudio.activeModel !== 'Stopped' && lmStudio.activeModel !== 'None loaded'
    ? lmStudio.activeModel : null;

  return (
    <div className="fade-in col gap-5">

      <div className="row sb">
        <div>
          <div className="section-title">Model Registry</div>
          <div className="section-sub">Browse and test available models across providers</div>
        </div>
        {lmStudio.running && (
          <span className="tag tag-green">● LM Studio Active</span>
        )}
      </div>

      {/* Registered Models */}
      <div className="card">
        <div className="card-title">Configured Models</div>
        {localModels.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 0' }}>
            <span className="empty-icon">◈</span>
            <span className="empty-text">No models configured yet. Add API keys in Integrations.</span>
          </div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Model</th><th>Provider</th><th>Endpoint</th><th style={{ textAlign: 'center' }}>Status</th></tr></thead>
            <tbody>
              {localModels.map((m, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono', fontSize: 12 }}>{m.name}</td>
                  <td><span className={`provider-badge pb-${m.provider}`}>{m.provider}</span></td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.base_url || `api.${m.provider}.com`}</td>
                  <td style={{ textAlign: 'center' }}>
                    {m.name === activeModel
                      ? <span className="tag tag-green">● Active</span>
                      : <span className="tag" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>Idle</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Browse Remote Models */}
      <div className="card">
        <div className="row sb mb-3">
          <div className="card-title" style={{ marginBottom: 0 }}>Available Models</div>
          <div className="row gap-2">
            {['local','anthropic','openai','gemini'].map(p => (
              <button
                key={p}
                className={`btn btn-sm ${selectedProvider === p ? 'btn-primary' : 'btn-ghost'}`}
                style={selectedProvider === p ? { background: providerColors[p], color: '#0d1117' } : {}}
                onClick={() => setSelectedProvider(p)}
              >
                {p}
              </button>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={loading}>
              {loading ? <CircularProgress size={12} style={{ color: 'inherit' }} /> : '↻'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="empty-state" style={{ padding: '24px 0' }}>
            <CircularProgress size={24} style={{ color: 'var(--accent-amber)' }} />
            <span className="empty-text">Fetching models…</span>
          </div>
        ) : fetchedModels.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 0' }}>
            <span className="empty-icon">◈</span>
            <span className="empty-text">No models returned. Check your API key in Integrations.</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
            {fetchedModels.map((m, i) => (
              <div key={i} className="row gap-2" style={{ padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 10, color: providerColors[selectedProvider] }}>◈</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{m.name || m.id}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Test Custom Endpoint */}
      <div className="card">
        <div className="card-title">Test Custom Endpoint</div>
        <div className="col gap-3">
          <div className="row gap-3">
            <div className="field-group" style={{ flex: 1 }}>
              <label className="field-label">Provider</label>
              <select className="field-input" value={newModel.provider} onChange={e => setNewModel(p => ({ ...p, provider: e.target.value }))}>
                <option value="local">Local</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
            <div className="field-group" style={{ flex: 2 }}>
              <label className="field-label">Model Tag</label>
              <input className="field-input" value={newModel.model} onChange={e => setNewModel(p => ({ ...p, model: e.target.value }))} placeholder="e.g. qwen2.5-7b-instruct" />
            </div>
          </div>
          <div className="row gap-3">
            <div className="field-group" style={{ flex: 2 }}>
              <label className="field-label">API Key (optional)</label>
              <input type="password" className="field-input" value={newModel.api_key} onChange={e => setNewModel(p => ({ ...p, api_key: e.target.value }))} placeholder="sk-…" />
            </div>
            <div className="field-group" style={{ flex: 2 }}>
              <label className="field-label">Base URL (local only)</label>
              <input className="field-input" value={newModel.base_url} onChange={e => setNewModel(p => ({ ...p, base_url: e.target.value }))} placeholder="http://localhost:1234/v1" />
            </div>
          </div>
          <div className="row gap-2">
            <button className="btn btn-primary" onClick={test} disabled={testingStatus === 'testing'}>
              {testingStatus === 'testing' ? <><CircularProgress size={12} style={{ color: 'inherit' }} /> Testing…</>
               : testingStatus === 'ok'      ? '✓ Connected'
               : testingStatus === 'fail'    ? '✗ Failed'
               : '⚡ Test Connection'}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
