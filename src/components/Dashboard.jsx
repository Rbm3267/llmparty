import React, { useState } from 'react';
import Chart from 'react-apexcharts';

const CHART_BASE = {
  toolbar: { show: false },
  background: 'transparent',
  animations: { enabled: true, easing: 'easeinout', speed: 600 },
};

const AXIS_STYLE = { colors: '#475569', fontSize: '11px', fontFamily: 'JetBrains Mono' };
const GRID_OPTS  = { borderColor: 'rgba(255,255,255,0.04)', strokeDashArray: 4 };
const TOOLTIP    = { theme: 'dark', style: { fontFamily: 'JetBrains Mono', fontSize: '12px' } };

export default function Dashboard({
  lmStudio, configs, stats,
  sysInfo = { cpuPercentage: 0, ramPercentage: 0 },
  localModels = [], proxyLogs = [],
  isBenchmarking, onRunBenchmark, onStartLMStudio, onStopLMStudio, triggerToast
}) {
  const [inspectLog, setInspectLog] = useState(null);

  // ── Derived metrics ────────────────────────────────
  const totalReqs  = proxyLogs.length;
  const successReqs = proxyLogs.filter(l => !l.error).length;
  const avgTtft    = proxyLogs.length ? Math.round(proxyLogs.reduce((a, l) => a + (l.ttft || 0), 0) / proxyLogs.length) : 0;
  const totalTokens = proxyLogs.reduce((a, l) => a + (l.promptTokens || 0) + (l.completionTokens || 0), 0);

  const primary  = configs.backends?.primary || 'anthropic';
  const pipeline = configs.backends?.pipeline || [];

  // ── Chart data ─────────────────────────────────────
  const sortedLogs = proxyLogs.length > 0 ? [...proxyLogs].reverse().slice(-8) : [];

  const hasLogs = sortedLogs.length > 0;
  const chartLabels = hasLogs
    ? sortedLogs.map(l => l.timestamp)
    : ['10 AM','11 AM','12 PM','1 PM','2 PM','3 PM','4 PM','5 PM'];

  const inputTokens  = hasLogs ? sortedLogs.map(l => l.promptTokens || 0)     : [1400,3200,2100,4800,3600,6200,5400,7100];
  const outputTokens = hasLogs ? sortedLogs.map(l => l.completionTokens || 0) : [700,1800,1100,2500,1900,3800,2900,4100];
  const ttftData     = hasLogs ? sortedLogs.map(l => l.ttft || 0)             : [120,88,105,78,92,67,95,73];
  const durationData = hasLogs ? sortedLogs.map(l => l.duration || 0)         : [540,380,420,310,430,295,450,280];

  // model share donut
  let shareLabels = [], shareSeries = [];
  if (proxyLogs.length > 0) {
    const counts = {};
    proxyLogs.forEach(l => { const k = (l.model || 'unknown').split('/').pop(); counts[k] = (counts[k] || 0) + 1; });
    shareLabels = Object.keys(counts).slice(0, 5);
    shareSeries = shareLabels.map(k => counts[k]);
  } else {
    shareLabels = ['No data yet'];
    shareSeries = [1];
  }

  // ── Chart configs ──────────────────────────────────
  const areaOpts = {
    chart: { ...CHART_BASE, id: 'tokens', stacked: false, type: 'area' },
    colors: ['#e879f9', '#22d3ee'],
    stroke: { curve: 'smooth', width: 2 },
    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.02, stops: [0, 95] } },
    xaxis: { categories: chartLabels, labels: { style: AXIS_STYLE }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: AXIS_STYLE } },
    grid: GRID_OPTS,
    tooltip: TOOLTIP,
    legend: { labels: { colors: '#94a3b8' }, fontSize: '11px', fontFamily: 'Inter' },
    dataLabels: { enabled: false },
  };

  const barOpts = {
    chart: { ...CHART_BASE, id: 'latency', type: 'bar' },
    colors: ['#a855f7', '#22d3ee'],
    plotOptions: { bar: { borderRadius: 3, columnWidth: '50%' } },
    xaxis: {
      categories: hasLogs ? sortedLogs.map((_, i) => `#${i + 1}`) : ['#1','#2','#3','#4','#5','#6','#7','#8'],
      labels: { style: AXIS_STYLE }, axisBorder: { show: false }, axisTicks: { show: false }
    },
    yaxis: { labels: { style: AXIS_STYLE, formatter: v => v + 'ms' } },
    grid: GRID_OPTS,
    tooltip: TOOLTIP,
    legend: { labels: { colors: '#94a3b8' }, fontSize: '11px', fontFamily: 'Inter' },
    dataLabels: { enabled: false },
  };

  const gaugeOpts = (label, color, toColor) => ({
    chart: { ...CHART_BASE, type: 'radialBar', sparkline: { enabled: true } },
    plotOptions: {
      radialBar: {
        startAngle: -120, endAngle: 120,
        hollow: { size: '62%' },
        track: { background: 'rgba(255,255,255,0.04)', strokeWidth: '100%' },
        dataLabels: {
          name: { show: true, color: '#475569', fontSize: '10px', offsetY: 22 },
          value: { color: '#f0f4f8', fontSize: '20px', fontWeight: 800, offsetY: -10, formatter: v => `${v}%` }
        }
      }
    },
    fill: { type: 'gradient', gradient: { shade: 'dark', type: 'horizontal', gradientToColors: [toColor || color], stops: [0, 100] } },
    stroke: { lineCap: 'round' },
    labels: [label],
  });

  const donutOpts = {
    chart: { ...CHART_BASE, type: 'donut' },
    colors: ['#e879f9', '#a855f7', '#22d3ee', '#4ade80', '#fb7185'],
    labels: shareLabels,
    stroke: { show: false },
    legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '11px', fontFamily: 'Inter', itemMargin: { vertical: 4 } },
    dataLabels: { enabled: false },
    plotOptions: { pie: { donut: { size: '68%', labels: { show: true,
      total: { show: true, label: 'Requests', color: '#94a3b8', fontSize: '11px', fontFamily: 'Inter',
        formatter: () => totalReqs.toString()
      },
      value: { color: '#f0f4f8', fontSize: '18px', fontWeight: 800, fontFamily: 'Inter' }
    }}}},
    tooltip: TOOLTIP,
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── KPI Row ─────────────────────────────────── */}
      <div className="stat-grid">
        <StatCard
          label="Total Requests"
          value={totalReqs}
          sub={`${successReqs} successful`}
          accent="primary"
          icon="↑"
        />
        <StatCard
          label="Avg TTFT"
          value={avgTtft ? `${avgTtft}ms` : '—'}
          sub="Time to first token"
          accent="cyan"
          icon="⚡"
        />
        <StatCard
          label="Total Tokens"
          value={totalTokens > 999 ? `${(totalTokens/1000).toFixed(1)}k` : totalTokens || '—'}
          sub="Prompt + completion"
          accent="violet"
          icon="◈"
        />
        <StatCard
          label="Cost Saved"
          value={`$${(stats.costSaved||0).toFixed(2)}`}
          sub="vs $15/1M token avg"
          accent="emerald"
          icon="▲"
        />
      </div>

      {/* ── Pipeline + Hardware ──────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

        {/* Pipeline */}
        <div className="card">
          <div className="card-title">Failover Pipeline</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pipeline.map((p, i) => (
              <div key={p} className="row gap-3" style={{ padding: '8px 10px', borderRadius: 8, background: p === primary ? 'rgba(245,158,11,0.06)' : 'transparent', border: '1px solid', borderColor: p === primary ? 'rgba(245,158,11,0.2)' : 'var(--border)' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', width: 14, fontFamily: 'JetBrains Mono' }}>{i + 1}</span>
                <span className={`provider-badge pb-${p}`}>{p}</span>
                {p === 'local' && <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{configs.backends?.local?.base_url || 'localhost:1234'}</span>}
                {p !== 'local' && <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{configs.backends?.[p]?.model || '—'}</span>}
                {p === primary && <span className="tag tag-amber">Primary</span>}
              </div>
            ))}
          </div>
          <hr className="sep" />
          <div className="row gap-2">
            {lmStudio.running
              ? <button className="btn btn-danger btn-sm" onClick={onStopLMStudio}>⏹ Stop LM Studio</button>
              : <button className="btn btn-success btn-sm" onClick={onStartLMStudio}>▶ Start LM Studio</button>
            }
            <button
              className="btn btn-ghost btn-sm"
              onClick={onRunBenchmark}
              disabled={isBenchmarking}
            >
              {isBenchmarking ? '⏳ Running…' : '⚗ Benchmark'}
            </button>
          </div>
        </div>

        {/* Hardware */}
        <div className="card">
          <div className="card-title">System Resources</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ textAlign: 'center' }}>
              <Chart options={gaugeOpts('CPU LOAD', '#e879f9', '#a855f7')} series={[sysInfo.cpuPercentage || 0]} type="radialBar" height={160} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <Chart options={gaugeOpts('RAM USED', '#22d3ee', '#4ade80')} series={[sysInfo.ramPercentage || 0]} type="radialBar" height={160} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <SysRow label="Platform" val={`${sysInfo.platform || '—'} ${sysInfo.arch || ''}`} />
            <SysRow label="CPU Cores" val={sysInfo.cpus || '—'} />
            <SysRow label="Total RAM" val={sysInfo.totalMemory || '—'} />
            <SysRow label="Free RAM"  val={sysInfo.freeMemory  || '—'} />
          </div>
        </div>
      </div>

      {/* ── Charts Row ──────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <div className="card">
          <div className="card-title">Token Throughput</div>
          <Chart
            options={areaOpts}
            series={[
              { name: 'Input Tokens',  data: inputTokens },
              { name: 'Output Tokens', data: outputTokens },
            ]}
            type="area"
            height={220}
          />
        </div>
        <div className="card">
          <div className="card-title">Request Distribution</div>
          <Chart options={donutOpts} series={shareSeries} type="donut" height={240} />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Latency Profile — TTFT vs Total Duration (ms)</div>
        <Chart
          options={barOpts}
          series={[
            { name: 'TTFT (ms)',     data: ttftData },
            { name: 'Total (ms)',    data: durationData },
          ]}
          type="bar"
          height={180}
        />
      </div>

      {/* ── Request Log Table ────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="row sb" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div className="card-title" style={{ marginBottom: 0 }}>Live Request Log</div>
          </div>
          <span className="tag tag-amber">{totalReqs} entries</span>
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Model</th>
                <th>Prompt Preview</th>
                <th style={{ textAlign: 'right' }}>Tokens In/Out</th>
                <th style={{ textAlign: 'right' }}>TTFT</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'center' }}>Status</th>
                <th style={{ textAlign: 'center' }}>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {proxyLogs.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <span className="empty-icon">◈</span>
                      <span className="empty-text">Waiting for requests on <span className="mono" style={{ color: 'var(--accent-amber)' }}>localhost:9990/v1</span></span>
                    </div>
                  </td>
                </tr>
              ) : (
                proxyLogs.map((log, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ color: 'var(--text-muted)', fontSize: 11 }}>{log.timestamp}</td>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 600, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.model}</td>
                    <td style={{ color: 'var(--text-muted)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.prompt}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--accent-amber)' }}>{log.promptTokens} / {log.completionTokens}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--accent-cyan)' }}>{log.ttft}ms</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--accent-violet)' }}>{log.duration}ms</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={log.error ? 'dot-offline' : 'dot-online'} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setInspectLog(log)}>View</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Inspect Modal ───────────────────────────── */}
      {inspectLog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(4px)' }}>
          <div className="card fade-in" style={{ width: 560, maxHeight: '80vh', overflowY: 'auto', background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)' }}>
            <div className="row sb mb-3">
              <span style={{ fontWeight: 700, fontSize: 14 }}>Request Inspector</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setInspectLog(null)}>✕ Close</button>
            </div>
            <div className="col gap-3">
              <div className="row gap-4">
                <MetaBox label="Model"    val={inspectLog.model} />
                <MetaBox label="TTFT"     val={`${inspectLog.ttft}ms`} accent="cyan" />
                <MetaBox label="Duration" val={`${inspectLog.duration}ms`} accent="violet" />
                <MetaBox label="Tokens"   val={`${inspectLog.promptTokens} / ${inspectLog.completionTokens}`} accent="amber" />
              </div>
              {inspectLog.system && <>
                <div className="field-label">System Prompt</div>
                <div className="code-block" style={{ maxHeight: 120 }}>{inspectLog.system}</div>
              </>}
              <div className="field-label">User Prompt</div>
              <div className="code-block" style={{ maxHeight: 200 }}>{inspectLog.prompt}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, accent, icon }) {
  const colors = { primary: '#e879f9', cyan: '#22d3ee', violet: '#a855f7', emerald: '#4ade80', amber: '#fbbf24' };
  const color = colors[accent] || '#f59e0b';
  return (
    <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div className="row sb mb-2">
        <span className="card-title" style={{ marginBottom: 0 }}>{label}</span>
        <span style={{ fontSize: 16, opacity: 0.3, color }}>{icon}</span>
      </div>
      <div className="card-value" style={{ color }}>{value}</div>
      <div className="card-sub">{sub}</div>
    </div>
  );
}

function SysRow({ label, val }) {
  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</div>
    </div>
  );
}

function MetaBox({ label, val, accent }) {
  const colors = { cyan: '#22d3ee', violet: '#a855f7', amber: '#e879f9' };
  const color = accent ? colors[accent] : 'var(--text-primary)';
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
      <div className="mono" style={{ fontSize: 12, fontWeight: 700, color }}>{val}</div>
    </div>
  );
}
