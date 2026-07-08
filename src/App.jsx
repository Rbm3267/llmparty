import React, { useState, useEffect } from 'react';
import { Snackbar, Alert } from '@mui/material';
import Dashboard from './components/Dashboard';
import Configuration from './components/Configuration';
import Models from './components/Models';
import Logs from './components/Logs';
import Settings from './components/Settings';
import logo from './assets/logo.jpg';
import './App.css';

// Browser fallback API
try {
  if (typeof window !== 'undefined' && !window.electronAPI) {
    window.electronAPI = {
      getStats: () => fetch('/api/stats').then(r => r.json()).catch(() => ({ costSaved: 0, requestsToday: 0, requestsThisWeek: 0, requestsThisMonth: 0, avgInferenceSpeed: 0 })),
      saveStats: (stats) => fetch('/api/stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stats) }).then(r => r.json()).catch(() => ({})),
      checkLMStudioStatus: () => fetch('/api/status').then(r => r.json()).catch(() => ({ running: false, activeModel: 'Stopped', modelsList: [] })),
      readConfigs: () => fetch('/api/configs').then(r => r.json()).catch(() => ({})),
      saveConfigs: (configs) => fetch('/api/configs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(configs) }).then(r => r.json()).catch(() => ({})),
      resetConfigs: () => fetch('/api/configs/reset', { method: 'POST' }).then(r => r.json()).catch(() => ({})),
      getModels: () => fetch('/api/configs').then(r => r.json()).then(configs => {
        const list = [];
        if (configs?.backends) {
          Object.keys(configs.backends).forEach(key => {
            if (!['primary','local_provider','pipeline'].includes(key)) {
              const d = configs.backends[key];
              if (d?.model) list.push({ name: d.model, provider: key, base_url: d.base_url || '' });
            }
          });
        }
        return list;
      }).catch(() => []),
      loadModel: (name) => fetch('/api/models/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then(r => r.json()).catch(() => ({})),
      launchClaudeCode: () => fetch('/api/launch/claude', { method: 'POST' }).then(r => r.json()).catch(() => ({})),
      launchAider: () => fetch('/api/launch/aider', { method: 'POST' }).then(r => r.json()).catch(() => ({})),
      startLMStudioServer: () => fetch('/api/lmstudio/start', { method: 'POST' }).then(r => r.json()).catch(() => ({})),
      stopLMStudioServer: () => fetch('/api/lmstudio/stop', { method: 'POST' }).then(r => r.json()).catch(() => ({})),
      getLogs: (service) => fetch(`/api/logs?service=${service}`).then(r => r.text()).catch(err => 'Error: ' + err.message),
      getSystemInfo: () => fetch('/api/sysinfo').then(r => r.json()).catch(() => ({ platform: 'Browser', arch: 'x64', totalMemory: '8 GB', freeMemory: '2 GB', cpus: '4 Cores' })),
      getProxyLogs: () => fetch('/api/proxy-logs').then(r => r.json()).catch(() => []),
      runBenchmark: () => fetch('/api/benchmark', { method: 'POST' }).then(r => r.json()).catch(() => ({ success: false, error: 'Benchmark unavailable' })),
    };
  }
} catch (e) {
  console.debug('[LLMParty] electronAPI set by contextBridge, skipping browser fallback.');
}

const NAV_ITEMS = [
  { id: 'dashboard',  label: 'Dashboard',      icon: '▦' },
  { id: 'config',     label: 'Integrations',   icon: '⚙' },
  { id: 'models',     label: 'Models',         icon: '◈' },
  { id: 'logs',       label: 'Logs',           icon: '≡' },
  { id: 'settings',   label: 'System',         icon: '◉' },
];

const PROVIDER_ICONS = { anthropic: '◆', openai: '○', gemini: '◇', local: '◎' };

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [toasts, setToasts] = useState([]);
  const [localModels, setLocalModels] = useState([]);
  const [lmStudio, setLmStudio] = useState({ running: false, activeModel: 'Stopped', modelsList: [] });
  const [configs, setConfigs] = useState({
    tui: { theme: 'party', status_bar_format: '', rainbow_speed: 1 },
    backends: {
      primary: 'anthropic',
      local_provider: 'lmstudio',
      pipeline: ['anthropic', 'openai', 'gemini', 'local'],
      anthropic: { api_key: '', model: 'claude-sonnet-4-6' },
      openai: { api_key: '', model: 'gpt-4o' },
      gemini: { api_key: '', model: 'gemini-2.5-flash' },
      local: { base_url: 'http://localhost:1234/v1', model: 'qwen2.5-7b-instruct-mlx' }
    }
  });
  const [stats, setStats] = useState({ costSaved: 0, requestsToday: 0, requestsThisWeek: 0, requestsThisMonth: 0, avgInferenceSpeed: 0 });
  const [sysInfo, setSysInfo] = useState({ cpuPercentage: 0, ramPercentage: 0, platform: '—', arch: '', totalMemory: '—', freeMemory: '—', cpus: '—' });
  const [proxyLogs, setProxyLogs] = useState([]);
  const [isBenchmarking, setIsBenchmarking] = useState(false);

  const triggerToast = (msg) => setToasts(p => [...p, { id: Date.now(), message: msg }]);

  const fetchAll = async () => {
    try {
      const [cfg, st, models, logs] = await Promise.all([
        window.electronAPI.readConfigs(),
        window.electronAPI.getStats(),
        window.electronAPI.getModels(),
        window.electronAPI.getProxyLogs(),
      ]);
      if (cfg?.backends) setConfigs(cfg);
      if (st) setStats(st);
      setLocalModels(models || []);
      setProxyLogs(logs || []);
    } catch (e) { /* silent */ }
  };

  const pollStatus = async () => {
    try {
      const [status, st, logs, info] = await Promise.all([
        window.electronAPI.checkLMStudioStatus(),
        window.electronAPI.getStats(),
        window.electronAPI.getProxyLogs(),
        window.electronAPI.getSystemInfo(),
      ]);
      setLmStudio(status);
      if (st) setStats(st);
      setProxyLogs(logs || []);
      setSysInfo(info);
    } catch (e) { /* silent */ }
  };

  useEffect(() => { fetchAll(); pollStatus(); const t = setInterval(pollStatus, 4000); return () => clearInterval(t); }, []);

  const handleSaveConfigs = async (cfg) => {
    if (window.electronAPI) await window.electronAPI.saveConfigs(cfg);
    setConfigs(cfg);
    triggerToast('Configuration saved');
  };

  const handleRunBenchmark = async () => {
    if (isBenchmarking) return;
    setIsBenchmarking(true);
    triggerToast('Running benchmark...');
    try {
      const r = await window.electronAPI.runBenchmark();
      if (r.success) triggerToast(`Benchmark: ${r.tokensPerSec} tok/s | TTFT: ${r.ttft}ms`);
      else triggerToast(`Benchmark failed: ${r.error}`);
    } finally { setIsBenchmarking(false); }
  };

  const primary = configs.backends?.primary || 'anthropic';
  const primaryModel = configs.backends?.[primary]?.model || '—';
  const totalRequests = (proxyLogs || []).length;

  return (
    <div className="app-shell">
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src={logo} alt="LLMParty Logo" className="logo-mark-img" />
          <div>
            <div className="logo-name">LLM<span className="gradient-text">Party</span></div>
            <div className="logo-sub" style={{color:'var(--accent-violet)', opacity: 0.7}}>AI Gateway v1.0</div>
          </div>
        </div>

        <div className="sidebar-section-label">Navigation</div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              {activeTab === item.id && <span className="nav-active-bar" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-section-label" style={{marginTop:'auto'}}>Gateway Status</div>
        <div className="sidebar-status-card">
          <div className="status-row">
            <span className="status-label">Proxy</span>
            <span className="status-val online">● Active :9990</span>
          </div>
          <div className="status-row">
            <span className="status-label">Provider</span>
            <span className="status-val" style={{textTransform:'capitalize'}}>{PROVIDER_ICONS[primary]} {primary}</span>
          </div>
          <div className="status-row">
            <span className="status-label">LM Studio</span>
            <span className={`status-val ${lmStudio.running ? 'online' : 'offline'}`}>
              {lmStudio.running ? '● Running' : '○ Stopped'}
            </span>
          </div>
          <div className="status-row">
            <span className="status-label">Requests</span>
            <span className="status-val">{totalRequests} logged</span>
          </div>
        </div>

        <div className="sidebar-gateway-url">
          <div className="gateway-label">Gateway Endpoint</div>
          <div className="gateway-url mono">localhost:9990/v1</div>
        </div>
      </aside>

      {/* ── Main Content ────────────────────────────── */}
      <main className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-left">
            <div className="page-breadcrumb">
              <span className="breadcrumb-root">LLMParty</span>
              <span className="breadcrumb-sep">›</span>
              <span className="breadcrumb-page">{NAV_ITEMS.find(n => n.id === activeTab)?.label}</span>
            </div>
          </div>
          <div className="topbar-right">
            <div className="topbar-stat">
              <span className="ts-label">Model</span>
              <span className="ts-val mono">{primaryModel}</span>
            </div>
            <div className="topbar-divider" />
            <div className="topbar-stat">
              <span className="ts-label">Cost Saved</span>
              <span className="ts-val" style={{color:'var(--accent-green)'}}>${(stats.costSaved||0).toFixed(2)}</span>
            </div>
            <div className="topbar-divider" />
            <div className="topbar-stat">
              <span className="ts-label">Today</span>
              <span className="ts-val">{stats.requestsToday||0} req</span>
            </div>
            <div className={`topbar-badge ${lmStudio.running ? 'badge-green' : 'badge-red'}`}>
              <span className={lmStudio.running ? 'dot-online' : 'dot-offline'} />
              LM Studio
            </div>
          </div>
        </header>

        {/* Page body */}
        <div className="page-body">
          {activeTab === 'dashboard' && (
            <Dashboard
              lmStudio={lmStudio} configs={configs} stats={stats} sysInfo={sysInfo}
              localModels={localModels} proxyLogs={proxyLogs} isBenchmarking={isBenchmarking}
              onRunBenchmark={handleRunBenchmark}
              onStartLMStudio={async () => { triggerToast('Starting LM Studio…'); await window.electronAPI.startLMStudioServer(); }}
              onStopLMStudio={async () => { triggerToast('Stopping LM Studio…'); await window.electronAPI.stopLMStudioServer(); }}
              triggerToast={triggerToast}
            />
          )}
          {activeTab === 'config' && (
            <Configuration configs={configs} localModels={localModels} onSaveConfigs={handleSaveConfigs} triggerToast={triggerToast} />
          )}
          {activeTab === 'models' && (
            <Models lmStudio={lmStudio} localModels={localModels} setLocalModels={setLocalModels} triggerToast={triggerToast} />
          )}
          {activeTab === 'logs' && <Logs triggerToast={triggerToast} />}
          {activeTab === 'settings' && <Settings triggerToast={triggerToast} />}
        </div>
      </main>

      {/* Toast */}
      <Snackbar
        open={toasts.length > 0}
        autoHideDuration={3000}
        onClose={() => setToasts(p => p.slice(1))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {toasts.length > 0 ? (
          <Alert
            severity="info"
            variant="filled"
            sx={{
              background: 'rgba(13,17,23,0.97)',
              border: '1px solid rgba(245,158,11,0.3)',
              color: '#f0f4f8',
              fontFamily: 'Inter',
              fontSize: 13,
              borderRadius: '10px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              '& .MuiAlert-icon': { color: 'var(--accent-amber)' }
            }}
          >
            {toasts[0]?.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </div>
  );
}
