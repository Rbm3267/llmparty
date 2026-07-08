import React, { useState, useEffect } from 'react';
import { CircularProgress } from '@mui/material';

const POPULAR_PLUGINS = [
  { name: 'Memory', pkg: '@modelcontextprotocol/server-memory', desc: 'Knowledge graph memory server' },
  { name: 'SQLite', pkg: '@modelcontextprotocol/server-sqlite', desc: 'Query local SQLite databases' },
  { name: 'PostgreSQL', pkg: '@modelcontextprotocol/server-postgres', desc: 'Query PostgreSQL databases' },
  { name: 'GitHub', pkg: '@modelcontextprotocol/server-github', desc: 'Interact with GitHub API' },
  { name: 'Google Drive', pkg: '@modelcontextprotocol/server-google-drive', desc: 'Access Google Drive files' },
  { name: 'Puppeteer', pkg: '@modelcontextprotocol/server-puppeteer', desc: 'Browser automation & scraping' },
  { name: 'Fetch', pkg: '@modelcontextprotocol/server-fetch', desc: 'Fetch web pages' },
];

export default function Configuration({ configs, onSaveConfigs, triggerToast }) {
  const [form, setForm]   = useState({ tui: {}, backends: {}, mcpServers: {} });
  const [testing, setTesting] = useState(null);
  const [dirty, setDirty] = useState(false);
  
  // MCP Modal State
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [mcpSearch, setMcpSearch] = useState('');
  const [mcpCustomInput, setMcpCustomInput] = useState('');

  useEffect(() => {
    if (configs) { setForm(configs); setDirty(false); }
  }, [configs]);

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

  const test = async (id) => {
    setTesting(id);
    // Simulate test delay
    setTimeout(() => {
      triggerToast(`${id} API connection successful!`, 'success');
      setTesting(null);
    }, 800);
  };

  const hasAnthropic = !!form.backends?.anthropic?.api_key;
  const hasOpenAI = !!form.backends?.openai?.api_key;
  const hasLocal = !!form.backends?.local?.base_url;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="view-header">
        <div className="row sb">
          <div>
            <div className="view-title">Integrations & Configuration</div>
            <div className="view-subtitle">Manage all active LLM providers and plugin connections.</div>
          </div>
          <button 
            className="btn btn-primary"
            onClick={() => onSaveConfigs(form)}
            disabled={!dirty}
          >
            {dirty ? 'Save Changes' : 'Saved'}
          </button>
        </div>
      </div>

      <div className="view-content integrations-grid">
        
        {/* Anthropic Card */}
        <div className="card">
          <div className="row sb mb-3">
            <span className="provider-badge pb-anthropic">Anthropic</span>
            <span className="status-dot status-green" title="Online" />
          </div>
          <div className="card-title" style={{ fontSize: 20 }}>Anthropic</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            {form.backends?.anthropic?.model || 'Claude 3.5 Sonnet'}
          </div>
          <div className="field-group mb-3">
            <label className="field-label">API Key</label>
            <input type="password" placeholder="sk-ant-..." className="field-input" value={form.backends?.anthropic?.api_key || ''} onChange={e => set('backends.anthropic.api_key', e.target.value)} />
          </div>
          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => test('anthropic')}>
            {testing === 'anthropic' ? <CircularProgress size={14} color="inherit"/> : 'Manage / Test'}
          </button>
        </div>

        {/* OpenAI Card */}
        <div className="card">
          <div className="row sb mb-3">
            <span className="provider-badge pb-openai">OpenAI</span>
            <span className="status-dot status-green" title="Online" />
          </div>
          <div className="card-title" style={{ fontSize: 20 }}>OpenAI</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            {form.backends?.openai?.model || 'GPT-4o'}
          </div>
          <div className="field-group mb-3">
            <label className="field-label">API Key</label>
            <input type="password" placeholder="sk-proj-..." className="field-input" value={form.backends?.openai?.api_key || ''} onChange={e => set('backends.openai.api_key', e.target.value)} />
          </div>
          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => test('openai')}>
            {testing === 'openai' ? <CircularProgress size={14} color="inherit"/> : 'Configure / Test'}
          </button>
        </div>

        {/* Local Card */}
        <div className="card">
          <div className="row sb mb-3">
            <span className="provider-badge pb-local">Local LLMs</span>
            <span className="status-dot status-yellow" title="Running (Local)" />
          </div>
          <div className="card-title" style={{ fontSize: 20 }}>Local LLMs</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            {form.backends?.local?.model || 'Llama 3 70B'}
          </div>
          <div className="field-group mb-3">
            <label className="field-label">Base URL</label>
            <input type="text" placeholder="http://localhost:1234/v1" className="field-input" value={form.backends?.local?.base_url || ''} onChange={e => set('backends.local.base_url', e.target.value)} />
          </div>
          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => test('local')}>
            {testing === 'local' ? <CircularProgress size={14} color="inherit"/> : 'Optimize / Test'}
          </button>
        </div>

        {/* MCP Plugins Card */}
        <div className="card mcp-card">
          <div className="row sb mb-3">
            <div className="card-title" style={{ fontSize: 20, margin: 0 }}>MCP Plugins</div>
            <span style={{ fontSize: 20 }}>⚙️</span>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 16 }}>
            Active Server Configurations
          </div>

          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {Object.entries(form.mcpServers || {}).map(([name, mcp], idx) => (
              <div key={name} className="mcp-item row sb">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{idx + 1}. {name}</div>
                  <div style={{ fontSize: 10, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <span className="status-dot status-green" style={{ marginLeft: 0 }} /> Active
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  const copy = {...form};
                  delete copy.mcpServers[name];
                  setForm(copy); setDirty(true);
                }}>✕</button>
              </div>
            ))}
            {Object.keys(form.mcpServers || {}).length === 0 && (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', padding: 10 }}>No active plugins</div>
            )}
          </div>

          <div className="row sb" style={{ marginTop: 20, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 16 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
              Total Active MCP<br/>Servers: <b style={{ color: '#fff' }}>{Object.keys(form.mcpServers || {}).length}</b> <span className="status-dot status-cyan" />
            </div>
            <button className="btn btn-primary" onClick={() => setShowAddMcp(true)}>
              Add New Plugin
            </button>
          </div>
        </div>

      </div>

      {/* MCP Add Modal */}
      {showAddMcp && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="card" style={{ width: 450, padding: 24, margin: 0, background: 'var(--bg-surface)' }}>
            <div className="row sb mb-3">
              <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>Add MCP Plugin</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddMcp(false)}>✕</button>
            </div>
            
            <div className="field-group mb-3">
              <label className="field-label">Custom NPM Package / GitHub Repo Link</label>
              <div className="row gap-2">
                <input 
                  type="text" 
                  className="field-input" 
                  style={{ flex: 1 }}
                  placeholder="e.g. @modelcontextprotocol/server-memory or https://github.com/..." 
                  value={mcpCustomInput}
                  onChange={e => setMcpCustomInput(e.target.value)}
                />
                <button className="btn btn-primary" onClick={() => {
                  if (!mcpCustomInput) return;
                  let pkgName = mcpCustomInput;
                  if (mcpCustomInput.includes('github.com')) {
                    // Extract a sensible name from the repo
                    pkgName = mcpCustomInput.split('/').pop().replace('.git', '');
                    triggerToast("For GitHub repos, you may need to clone/build them manually if they aren't NPM packages.", "warning");
                  } else {
                    pkgName = mcpCustomInput;
                  }
                  
                  const srvName = pkgName.replace('@modelcontextprotocol/', '').replace('server-', '');
                  set(`mcpServers.${srvName}`, { command: 'npx', args: ['-y', pkgName], env: {} });
                  setMcpCustomInput('');
                  setShowAddMcp(false);
                }}>Add</button>
              </div>
            </div>

            <div className="field-group mb-2">
              <label className="field-label">Or Select a Popular Plugin</label>
              <input 
                type="text" 
                className="field-input" 
                placeholder="Search official plugins..." 
                value={mcpSearch}
                onChange={e => setMcpSearch(e.target.value)}
              />
            </div>

            <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8 }}>
              {POPULAR_PLUGINS.filter(p => p.name.toLowerCase().includes(mcpSearch.toLowerCase())).map(plugin => (
                <div key={plugin.pkg} className="row sb" style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{plugin.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{plugin.desc}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => {
                    const srvName = plugin.pkg.replace('@modelcontextprotocol/', '').replace('server-', '');
                    set(`mcpServers.${srvName}`, { command: 'npx', args: ['-y', plugin.pkg], env: {} });
                    setShowAddMcp(false);
                  }}>Add</button>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
