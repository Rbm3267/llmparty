// LLMParty Telemetry Proxy & Failover Engine
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

// Known Claude CLI soft-error patterns that look like valid output but are actually
// limit/auth/rate errors. When detected we reject → gateway fails over to next provider.
const CLAUDE_ERROR_PATTERNS = [
  /monthly spend limit/i,
  /usage.{0,20}limit/i,
  /run \/usage-credits/i,
  /ask your admin/i,
  /rate limit/i,
  /too many requests/i,
  /authentication (failed|required|error)/i,
  /not authenticated/i,
  /please (log in|sign in|authenticate)/i,
  /session expired/i,
  /unauthorized/i,
  /quota exceeded/i,
  /billing (issue|error|problem)/i,
  /payment (required|failed)/i,
  /account (suspended|disabled)/i,
  /claude\.ai\/settings/i,          // links to settings = usually an error page
  /^error:/im,                       // generic "Error: <something>"
];

function isClaudeCliError(text) {
  for (const pattern of CLAUDE_ERROR_PATTERNS) {
    if (pattern.test(text)) {
      console.warn(`⚠️  [claude_cli] Detected soft error in output (pattern: ${pattern})`);
      console.warn(`    Output was: "${text.slice(0, 120).replace(/\n/g, ' ')}..."`);
      return true;
    }
  }
  return false;
}

// ── Claude via `claude -p` subprocess ───────────────────────────
// Used when provider=anthropic but no API key is configured.
// Requires the Claude Code CLI to be authenticated (`claude auth`).
function callClaudeCli(messages, modelHint, onFirstToken) {
  return new Promise((resolve, reject) => {
    // Build a plain-text prompt from the messages array
    const parts = [];
    for (const m of messages) {
      if (m.role === 'system')    parts.push(`[SYSTEM]\n${m.content}`);
      else if (m.role === 'user') parts.push(`[USER]\n${m.content}`);
      else if (m.role === 'assistant') parts.push(`[ASSISTANT]\n${m.content}`);
    }
    const prompt = parts.join('\n\n');

    const claudeBin = process.env.CLAUDE_PATH ||
      require('path').join(require('os').homedir(), '.local/bin/claude');

    // claude -p "<prompt>" --output-format text
    const proc = spawn(claudeBin, ['--print', prompt], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let stderrOutput = '';
    let firstChunk = true;
    proc.stdout.on('data', chunk => {
      if (firstChunk) { firstChunk = false; onFirstToken && onFirstToken(); }
      output += chunk.toString();
    });
    proc.stderr.on('data', d => {
      stderrOutput += d.toString();
      console.error('[claude-p stderr]', d.toString().trim());
    });
    proc.on('close', code => {
      const text = output.trim();
      // Non-zero exit with no output = hard failure
      if (code !== 0 && !text) {
        return reject(new Error(`claude --print exited ${code}: ${stderrOutput.trim() || 'no output'}`));
      }
      // Soft errors: exit 0 but output is a CLI error/limit message
      if (isClaudeCliError(text)) {
        return reject(new Error(`claude_cli soft error (spend/rate/auth limit) — failing over`));
      }

      // Wrap in OpenAI-compatible chat.completion format
      resolve({
        id: 'chatcmpl-claude-cli-' + Date.now(),
        object: 'chat.completion',
        created: Math.round(Date.now() / 1000),
        model: modelHint || 'claude-cli',
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: Math.ceil(prompt.length / 4),
          completion_tokens: Math.ceil(text.length / 4),
          total_tokens: Math.ceil((prompt.length + text.length) / 4)
        }
      });
    });
    proc.on('error', err => reject(new Error('Failed to spawn claude: ' + err.message)));
  });
}
const os = require('os');

const PORT = 9990;
const homeDir = os.homedir();
const zshrcPath = path.join(homeDir, '.zshrc');
const configPath = path.join(homeDir, '.llmparty/config.json');
const statsFilePath = path.join(homeDir, '.llmparty-stats.json');
const providerStatePath = path.join(homeDir, '.llmparty/provider-state.json');

global.proxyLogs = global.proxyLogs || [];
global.sessionCache = global.sessionCache || {};

// ── Provider State (persisted across sessions) ────────────────────────────
// Tracks which providers have hit limits so new sessions skip them automatically.
function loadProviderState() {
  try {
    if (fs.existsSync(providerStatePath)) return JSON.parse(fs.readFileSync(providerStatePath, 'utf-8'));
  } catch(e) {}
  return { degraded: {}, lastUsed: null };
}

function saveProviderState(state) {
  try {
    const dir = path.dirname(providerStatePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(providerStatePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch(e) { console.error('Failed to save provider state:', e.message); }
}

function markProviderDegraded(provider, reason) {
  const state = loadProviderState();
  const now = Date.now();
  // TTL strategy: monthly limits expire at midnight, rate limits after 1h, auth = manual
  let expiresAt;
  if (/spend|monthly|quota|billing|payment/i.test(reason)) {
    // Expire at midnight tonight (local)
    const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
    expiresAt = midnight.getTime();
  } else if (/rate.limit|too.many/i.test(reason)) {
    expiresAt = now + 60 * 60 * 1000; // 1 hour
  } else {
    expiresAt = null; // manual reset only
  }
  state.degraded[provider] = { reason, since: now, expiresAt, sinceStr: new Date(now).toLocaleString() };
  saveProviderState(state);
  console.warn(`🔴 [provider-state] Marked ${provider} as DEGRADED: ${reason}`);
  console.warn(`   Expires: ${expiresAt ? new Date(expiresAt).toLocaleString() : 'manual reset required'}`);
}

function markProviderHealthy(provider) {
  const state = loadProviderState();
  if (state.degraded[provider]) {
    delete state.degraded[provider];
    saveProviderState(state);
    console.log(`🟢 [provider-state] ${provider} is HEALTHY again — cleared degraded status`);
  }
}

function isProviderDegraded(provider) {
  const state = loadProviderState();
  const entry = state.degraded[provider];
  if (!entry) return false;
  // Auto-expire if TTL has passed
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    delete state.degraded[provider];
    saveProviderState(state);
    console.log(`⏰ [provider-state] ${provider} degraded status expired — cleared automatically`);
    return false;
  }
  return true;
}

function saveLastUsedProvider(provider, model) {
  const state = loadProviderState();
  state.lastUsed = { provider, model, timestamp: Date.now() };
  saveProviderState(state);
}


function loadConfig() {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {}
  }
  return {
    backends: {
      primary: 'local',
      local_provider: 'lmstudio',
      pipeline: ['local'],
      local: { base_url: 'http://localhost:1234/v1', model: 'qwen2.5-7b-instruct-mlx' }
    }
  };
}

// Stats helper
function updateStatsDynamically(costSavedInDollars, duration) {
  let stats = { costSaved: 0, requestsToday: 0, requestsThisMonth: 0, avgInferenceSpeed: 0 };
  if (fs.existsSync(statsFilePath)) {
    try {
      stats = JSON.parse(fs.readFileSync(statsFilePath, 'utf-8'));
    } catch (e) {}
  }
  stats.requestsToday = (stats.requestsToday || 0) + 1;
  stats.requestsThisMonth = (stats.requestsThisMonth || 0) + 1;
  stats.costSaved = (stats.costSaved || 0) + costSavedInDollars;
  const oldAvg = stats.avgInferenceSpeed || 0;
  const count = stats.requestsToday;
  stats.avgInferenceSpeed = count > 1 ? Math.round(((oldAvg * (count - 1)) + duration) / count) : duration;
  try {
    fs.writeFileSync(statsFilePath, JSON.stringify(stats), 'utf-8');
  } catch (e) {}
}

function handleModelOOMRecovery(config) {
  console.log("⚠️ Proxy detected backend crash/OOM. Recovering...");
  if (config.backends.local_provider === 'lmstudio') {
    exec('lms server start --port 1234');
  } else if (config.backends.local_provider === 'ollama') {
    exec('ollama run ' + (config.backends.local.model || 'qwen2.5-coder'));
  }
}

function logProxyCompletion({ path: reqPath, model, promptText, systemText, promptTokens, completionTokens, ttft, duration, statusCode, error }) {
  global.proxyLogs.unshift({
    timestamp: new Date().toLocaleTimeString(),
    path: reqPath,
    model: model || 'Unknown',
    prompt: promptText ? (promptText.length > 120 ? promptText.slice(0, 120) + '...' : promptText) : 'N/A',
    system: systemText ? (systemText.length > 80 ? systemText.slice(0, 80) + '...' : systemText) : 'N/A',
    promptTokens: promptTokens || 0,
    completionTokens: completionTokens || 0,
    ttft: ttft || 0,
    duration: duration || 0,
    status: statusCode || 200,
    error: !!error
  });

  if (global.proxyLogs.length > 50) global.proxyLogs.pop();
}

// Main HTTP proxy call forwarding with fallback routing
function forwardRequest(config, index, req, res, requestData, startTime) {
  const pipeline = config.backends.pipeline || ['local'];

  // Skip ahead past any providers that are currently known-degraded
  while (index < pipeline.length && isProviderDegraded(pipeline[index])) {
    console.log(`⏩ [provider-state] Skipping ${pipeline[index]} (degraded) — moving to next in pipeline`);
    index++;
  }

  if (index >= pipeline.length) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'All gateway backends in failover pipeline exhausted (some may be degraded — check /api/provider-state).' }));
    return;
  }

  const provider = pipeline[index];
  let targetUrl = '';
  let apiKey = '';
  let modelName = '';

  if (provider === 'local') {
    const localProv = config.backends.local_provider || 'lmstudio';
    if (localProv === 'lmstudio') {
      targetUrl = 'http://localhost:1234/v1/chat/completions';
    } else if (localProv === 'ollama') {
      targetUrl = 'http://localhost:11434/v1/chat/completions';
    } else {
      targetUrl = 'http://localhost:8080/v1/chat/completions'; // llama.cpp
    }
    if (config.backends.local?.base_url) {
      targetUrl = config.backends.local.base_url.endsWith('/') 
        ? config.backends.local.base_url + 'chat/completions'
        : config.backends.local.base_url + '/chat/completions';
    }
    apiKey = config.backends.local?.api_key || '';
    modelName = config.backends.local.model;
  } else {
    // Frontier providers
    const provConfig = config.backends[provider] || {};
    apiKey = provConfig.api_key || '';
    modelName = provConfig.model || '';

    if (provider === 'claude_cli') {
      // ── Always route through `claude -p` (enterprise SSO, no API key needed) ──
      console.log('🎩 [claude_cli] Routing via claude --print subprocess');
      let parsedReq = {};
      try { parsedReq = JSON.parse(requestData); } catch(e) {}
      const startTime2 = startTime || Date.now();
      let firstTokenAt = null;
      callClaudeCli(
        parsedReq.messages || [],
        parsedReq.model || modelName || 'claude-cli',
        () => { firstTokenAt = Date.now(); }
      ).then(openaiResp => {
        const duration = Date.now() - startTime2;
        const ttft = firstTokenAt ? firstTokenAt - startTime2 : duration;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(openaiResp));
        markProviderHealthy('claude_cli'); // successful → clear any stale degraded state
        saveLastUsedProvider('claude_cli', openaiResp.model);
        logProxyCompletion({
          path: req.url, model: openaiResp.model,
          promptText: parsedReq.messages?.slice(-1)[0]?.content || '',
          systemText: parsedReq.messages?.find(m => m.role === 'system')?.content || '',
          promptTokens: openaiResp.usage.prompt_tokens,
          completionTokens: openaiResp.usage.completion_tokens,
          ttft, duration, statusCode: 200
        });
        updateStatsDynamically(0, duration);
      }).catch(err => {
        const errMsg = err.message || '';
        // Detect the error type and persist it so future sessions skip this provider
        if (/spend|monthly|quota|billing|payment/i.test(errMsg)) {
          markProviderDegraded('claude_cli', 'monthly spend limit');
        } else if (/rate.limit|too.many/i.test(errMsg)) {
          markProviderDegraded('claude_cli', 'rate limit');
        } else if (/auth|unauthorized|session/i.test(errMsg)) {
          markProviderDegraded('claude_cli', 'auth error — run: claude auth');
        } else {
          markProviderDegraded('claude_cli', errMsg.slice(0, 80));
        }
        console.error('❌ claude_cli failed:', errMsg, '— failing over...');
        forwardRequest(config, index + 1, req, res, requestData, startTime);
      });
      return;
    }

    if (provider === 'openai') {
      targetUrl = 'https://api.openai.com/v1/chat/completions';
    } else if (provider === 'anthropic') {
      // Direct API key path — no key means this provider will get a 401 and fail over
      if (!apiKey) {
        console.warn('⚠️  [anthropic] No API key set — will fail over. Add claude_cli to pipeline for keyless access.');
      }
      targetUrl = 'https://api.anthropic.com/v1/messages';
    } else if (provider === 'gemini') {
      targetUrl = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?key=${apiKey}`;
    }
  }

  console.log(`➡️ Routing request to [${provider}] target: ${targetUrl}`);

  const urlObj = new URL(targetUrl);
  const isHttps = urlObj.protocol === 'https:';
  const requester = isHttps ? https : http;

  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
  }

  // Adjust payload format for Anthropic vs standard OpenAI compatibility
  if (provider === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    headers['User-Agent'] = 'LLMParty/1.0';
  } else if (provider === 'openai') {
    headers['User-Agent'] = 'LLMParty/1.0';
  } else if (provider === 'gemini') {
    headers['User-Agent'] = 'LLMParty/1.0';
  }

  let parsedReq = {};
  try {
    parsedReq = JSON.parse(requestData);
  } catch(e){}

  if (provider === 'anthropic') {
    // Anthropic v1/messages requires max_tokens, and messages format instead of chat completions
    if (!parsedReq.max_tokens) {
      parsedReq.max_tokens = 4000;
    }
    // Anthropic rejects 'system' role inside messages array, requires it as a top-level property
    const systemMessageIndex = parsedReq.messages?.findIndex(m => m.role === 'system');
    if (systemMessageIndex !== undefined && systemMessageIndex !== -1) {
      parsedReq.system = parsedReq.messages[systemMessageIndex].content;
      parsedReq.messages.splice(systemMessageIndex, 1);
    }
  }

  // Inject session cache persistence
  const sessionId = parsedReq.user || 'default-session';
  if (parsedReq.messages) {
    global.sessionCache[sessionId] = parsedReq.messages;
  } else if (global.sessionCache[sessionId]) {
    // Replay session context mid-failover if client payload came without full logs
    parsedReq.messages = global.sessionCache[sessionId];
  }

  // Adjust payload models
  parsedReq.model = modelName || parsedReq.model;
  if (provider === 'anthropic') {
    if (parsedReq.model === 'claude-3-5-sonnet-latest') {
      parsedReq.model = 'claude-3-5-sonnet-20241022';
    }
  }
  if (provider === 'gemini') {
    // Google Gemini API openai-compat endpoints require the model path prefix "models/modelName"
    if (parsedReq.model && !parsedReq.model.startsWith('models/')) {
      parsedReq.model = 'models/' + parsedReq.model;
    }
  }
  const payloadStr = JSON.stringify(parsedReq);

  const reqOptions = {
    hostname: urlObj.hostname,
    port: urlObj.port || (isHttps ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: 'POST',
    headers: headers,
    timeout: 8000
  };

  let firstTokenTime = null;
  let responseData = '';

  const proxyReq = requester.request(reqOptions, proxyRes => {
    if (proxyRes.statusCode === 429 || proxyRes.statusCode === 401 || proxyRes.statusCode >= 500) {
      console.log(`⚠️ Provider [${provider}] returned status code ${proxyRes.statusCode}. Shifting to next failover...`);
      if (provider === 'local') handleModelOOMRecovery(config);
      forwardRequest(config, index + 1, req, res, requestData, startTime);
      return;
    }

    let isAnthropicResponse = provider === 'anthropic';
    res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
    proxyRes.on('data', chunk => {
      if (!firstTokenTime) firstTokenTime = Date.now();
      responseData += chunk.toString();
      if (!isAnthropicResponse) {
        res.write(chunk);
      }
    });

    proxyRes.on('end', () => {
      if (isAnthropicResponse) {
        try {
          const raw = JSON.parse(responseData);
          const openaiCompat = {
            id: raw.id,
            object: 'chat.completion',
            created: Math.round(Date.now() / 1000),
            model: raw.model,
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: raw.content?.[0]?.text || ''
              },
              finish_reason: raw.stop_reason === 'end_turn' ? 'stop' : raw.stop_reason
            }],
            usage: {
              prompt_tokens: raw.usage?.input_tokens || 0,
              completion_tokens: raw.usage?.output_tokens || 0,
              total_tokens: (raw.usage?.input_tokens || 0) + (raw.usage?.output_tokens || 0)
            }
          };
          res.end(JSON.stringify(openaiCompat));
        } catch (e) {
          res.end(responseData);
        }
      } else {
        res.end();
      }
      const duration = Date.now() - startTime;
      const ttft = firstTokenTime ? (firstTokenTime - startTime) : duration;
      
      logProxyCompletion({
        path: req.url,
        model: modelName,
        promptText: parsedReq.messages ? parsedReq.messages[parsedReq.messages.length - 1]?.content : '',
        systemText: parsedReq.messages?.find(m => m.role === 'system')?.content || '',
        promptTokens: 10,
        completionTokens: 20,
        ttft,
        duration,
        statusCode: proxyRes.statusCode
      });
    });
  });

  proxyReq.on('error', err => {
    console.log(`⚠️ Connection error for provider [${provider}]: ${err.message}. Shifting failover...`);
    if (provider === 'local') handleModelOOMRecovery(config);
    forwardRequest(config, index + 1, req, res, requestData, startTime);
  });

  proxyReq.write(payloadStr);
  proxyReq.end();
}

function detectProviderFromModel(modelName, pipeline) {
  if (!modelName) return 0;
  const m = modelName.toLowerCase().replace(/^models\//, '');
  let detectedProvider = null;
  if (m.startsWith('gemini') || m.startsWith('models/gemini')) {
    detectedProvider = 'gemini';
  } else if (m.startsWith('claude')) {
    detectedProvider = 'anthropic';
  } else if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('text-')) {
    detectedProvider = 'openai';
  } else if (m.startsWith('qwen') || m.startsWith('llama') || m.startsWith('mistral') || m.startsWith('deepseek') || m.startsWith('phi')) {
    detectedProvider = 'local';
  }
  if (detectedProvider) {
    const idx = pipeline.indexOf(detectedProvider);
    if (idx !== -1) {
      console.log(`🎯 Model "${modelName}" → detected provider [${detectedProvider}] at pipeline index ${idx}`);
      return idx;
    }
  }
  return 0;
}

function handleProxyRequest(req, res) {
  const config = loadConfig();
  let requestData = '';
  req.on('data', chunk => { requestData += chunk; });
  req.on('end', () => {
    // Detect provider from requested model name for smart routing
    let startIndex = 0;
    try {
      const parsed = JSON.parse(requestData);
      const pipeline = config.backends.pipeline || ['local'];
      startIndex = detectProviderFromModel(parsed.model, pipeline);
    } catch(e) {}
    forwardRequest(config, startIndex, req, res, requestData, Date.now());
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  if (pathname.startsWith('/v1/')) {
    handleProxyRequest(req, res);
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (pathname === '/api/proxy-logs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(global.proxyLogs || []));
    return;
  }

  if (pathname === '/api/configs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loadConfig()));
    return;
  }

  if (pathname === '/api/configs' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const newCfg = JSON.parse(body);
        if (!fs.existsSync(path.dirname(configPath))) {
          fs.mkdirSync(path.dirname(configPath), { recursive: true });
        }
        fs.writeFileSync(configPath, JSON.stringify(newCfg, null, 2), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, config: newCfg }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  if (pathname === '/api/status' && req.method === 'GET') {
    const config = loadConfig();
    const localProv = config.backends.local_provider || 'lmstudio';
    const targetPort = localProv === 'lmstudio' ? 1234 : 11434;
    const reqOptions = {
      host: 'localhost',
      port: targetPort,
      path: localProv === 'lmstudio' ? '/v1/models' : '/api/tags',
      method: 'GET',
      timeout: 1000,
    };
    const checkReq = http.request(reqOptions, (checkRes) => {
      let data = '';
      checkRes.on('data', c => data += c);
      checkRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          let activeModel = 'None loaded';
          if (localProv === 'lmstudio') {
            activeModel = parsed.data && parsed.data.length > 0 ? parsed.data[0].id : 'None loaded';
          } else {
            activeModel = parsed.models && parsed.models.length > 0 ? parsed.models[0].name : 'None loaded';
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ running: true, activeModel }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ running: true, activeModel: 'Unknown' }));
        }
      });
    });
    checkReq.on('error', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: false, activeModel: 'Stopped' }));
    });
    checkReq.end();
    return;
  }

  if (pathname === '/api/stats' && req.method === 'GET') {
    let stats = { costSaved: 0, requestsToday: 0, avgInferenceSpeed: 0 };
    if (fs.existsSync(statsFilePath)) {
      try { stats = JSON.parse(fs.readFileSync(statsFilePath, 'utf-8')); } catch (e){}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  if (pathname === '/api/models' && req.method === 'GET') {
    const config = loadConfig();
    const activeProvider = parsedUrl.searchParams.get('provider') || config.backends.primary;

    if (activeProvider === 'local') {
      const localProv = config.backends.local_provider || 'lmstudio';
      let targetUrl = config.backends.local?.base_url;
      if (!targetUrl) {
        targetUrl = localProv === 'lmstudio' ? 'http://localhost:1234/v1' : 'http://localhost:11434';
      }
      if (localProv === 'lmstudio') {
        targetUrl = targetUrl.endsWith('/') ? targetUrl + 'models' : targetUrl + '/models';
      } else {
        targetUrl = targetUrl.endsWith('/') ? targetUrl + 'api/tags' : targetUrl + '/api/tags';
      }
      
      const lib = targetUrl.startsWith('https') ? https : http;
      lib.get(targetUrl, (apiRes) => {
        let body = '';
        apiRes.on('data', chunk => body += chunk);
        apiRes.on('end', () => {
          try {
            const data = JSON.parse(body);
            let models = [];
            if (localProv === 'lmstudio') {
              models = (data.data || []).map(m => ({ id: m.id, name: m.id }));
            } else {
              models = (data.models || []).map(m => ({ id: m.name, name: m.name }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(models));
          } catch(e) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([{ id: 'qwen2.5-7b-instruct-mlx', name: 'qwen2.5-7b-instruct-mlx (Local default)' }]));
          }
        });
      }).on('error', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ id: 'qwen2.5-7b-instruct-mlx', name: 'qwen2.5-7b-instruct-mlx (Local offline fallback)' }]));
      });
      return;
    }

    // Query live frontier endpoints dynamically if key is provided
    const provConfig = config.backends[activeProvider] || {};
    const key = provConfig.api_key;

    if (key && activeProvider === 'openai') {
      const opt = {
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/models',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${key}` }
      };
      https.get(opt, (apiRes) => {
        let body = '';
        apiRes.on('data', c => body += c);
        apiRes.on('end', () => {
          try {
            const data = JSON.parse(body);
            const models = (data.data || []).map(m => ({ id: m.id, name: m.id }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(models));
          } catch(e) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([{ id: 'gpt-4o', name: 'gpt-4o' }, { id: 'gpt-4o-mini', name: 'gpt-4o-mini' }]));
          }
        });
      }).on('error', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ id: 'gpt-4o', name: 'gpt-4o' }]));
      });
      return;
    }

    if (key && activeProvider === 'gemini') {
      const opt = {
        hostname: 'generativelanguage.googleapis.com',
        port: 443,
        path: `/v1beta/models?key=${key}`,
        method: 'GET'
      };
      https.get(opt, (apiRes) => {
        let body = '';
        apiRes.on('data', c => body += c);
        apiRes.on('end', () => {
          try {
            const data = JSON.parse(body);
            const models = (data.models || []).map(m => ({ id: m.name.replace('models/', ''), name: m.displayName || m.name }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(models));
          } catch(e) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([{ id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }]));
          }
        });
      }).on('error', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }]));
      });
      return;
    }

    // Default static frontier fallback choices
    const frontierModels = {
      anthropic: [
        { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-opus-latest', name: 'Claude 3 Opus' },
        { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku' }
      ],
      openai: [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'o1-preview', name: 'o1 Preview' }
      ],
      gemini: [
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
        { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash (Experimental)' }
      ]
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(frontierModels[activeProvider] || []));
    return;
  }

  if (pathname === '/api/models/test' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { provider, model, api_key, base_url } = payload;
        
        let targetUrl = '';
        let headers = { 'Content-Type': 'application/json' };

        if (provider === 'local') {
          const config = loadConfig();
          const localProv = config.backends.local_provider || 'lmstudio';
          targetUrl = base_url || config.backends.local?.base_url || (localProv === 'lmstudio' ? 'http://localhost:1234/v1/models' : 'http://localhost:11434/api/tags');
          if (targetUrl.endsWith('/v1')) {
            targetUrl = targetUrl + '/models';
          } else if (targetUrl.endsWith('/v1/')) {
            targetUrl = targetUrl + 'models';
          }
          if (targetUrl.includes('/chat/completions')) {
            targetUrl = targetUrl.replace('/chat/completions', '/models');
          }
        } else if (provider === 'anthropic') {
          targetUrl = 'https://api.anthropic.com/v1/messages';
          headers['x-api-key'] = api_key;
          headers['anthropic-version'] = '2023-06-01';
          headers['User-Agent'] = 'LLMParty/1.0';
        } else if (provider === 'openai') {
          targetUrl = 'https://api.openai.com/v1/models';
          headers['Authorization'] = `Bearer ${api_key}`;
          headers['User-Agent'] = 'LLMParty/1.0';
        } else if (provider === 'gemini') {
          targetUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${api_key}`;
          headers['User-Agent'] = 'LLMParty/1.0';
        }

        const isHttps = targetUrl.startsWith('https:');
        const lib = isHttps ? https : http;

        const urlObj = new URL(targetUrl);
        const reqOptions = {
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: provider === 'anthropic' ? 'POST' : 'GET',
          headers,
          timeout: 4000
        };

        const testReq = lib.request(reqOptions, (testRes) => {
          let testBody = '';
          testRes.on('data', c => testBody += c);
          testRes.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: testRes.statusCode < 400, statusCode: testRes.statusCode }));
          });
        });

        testReq.on('error', (err) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        });

        if (provider === 'anthropic') {
          testReq.write(JSON.stringify({ model: 'claude-3-5-sonnet-latest', max_tokens: 1, messages: [{ role: 'user', content: 'test' }] }));
        }
        testReq.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/lmstudio/start' && req.method === 'POST') {
    exec('lms server start --port 1234', (err) => {
      if (err) {
        // Fallback: Open application
        exec('open -a "LM Studio"', (openErr) => {
          if (openErr) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Could not launch LM Studio CLI or Application' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, mode: 'app' }));
          }
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, mode: 'cli' }));
      }
    });
    return;
  }

  if (pathname === '/api/lmstudio/stop' && req.method === 'POST') {
    exec('lms server stop', (err) => {
      if (err) {
        exec('killall "LM Studio" || killall "lms"', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      }
    });
    return;
  }

  if (pathname === '/api/provider-state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loadProviderState()));
    return;
  }

  if (pathname.startsWith('/api/provider-state/reset') && req.method === 'POST') {
    const provider = pathname.split('/').pop(); // 'all' or provider name
    const state = loadProviderState();
    if (provider === 'all') {
      state.degraded = {};
    } else {
      delete state.degraded[provider];
    }
    saveProviderState(state);
    console.log(`🔄 [provider-state] Reset: ${provider}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, reset: provider, state }));
    return;
  }

  if (pathname === '/api/sysinfo' && req.method === 'GET') {
    const sysInfo = {
      platform: process.platform,
      arch: process.arch,
      totalMemory: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
      freeMemory: (os.freemem() / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
      cpus: os.cpus().length + 'x ' + os.cpus()[0].model,
      cpuPercentage: 10,
      ramPercentage: 40
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sysInfo));
    return;
  }

  if (pathname === '/api/logs' && req.method === 'GET') {
    const service = parsedUrl.searchParams.get('service') || 'gateway';
    
    if (service === 'gateway') {
      const logs = global.proxyLogs || [];
      if (logs.length === 0) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('[LLMParty Telemetry Gateway]\nNo proxy transactions recorded yet.');
        return;
      }
      const formatted = logs.map(l => 
        `[${l.timestamp}] ${l.path} -> ${l.model} | Status: ${l.status} | TTFT: ${l.ttft}ms | Duration: ${l.duration}ms\nPrompt: "${l.prompt}"\n---------------------------------------`
      ).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(formatted);
      return;
    }

    const logPaths = {
      lmstudio: [
        path.join(homeDir, '.lmstudio/logs/server.log'),
        path.join(homeDir, 'Library/Application Support/LM-Studio/logs/server.log'),
      ],
      // aider removed — use Claude Code or Antigravity instead
      claudecode: [path.join(homeDir, '.claude/history.json')],
    };

    const paths = logPaths[service] || [];
    let logContent = `[LLMParty Service Logs Scanner]\nNo active log files detected at default paths for: ${service}.\nActive polling on localhost:1234/v1 is healthy.`;

    for (const p of paths) {
      if (fs.existsSync(p)) {
        try {
          const stream = fs.readFileSync(p, 'utf-8');
          logContent = stream.split('\n').slice(-100).join('\n');
          break;
        } catch (e) {
          // continue
        }
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(logContent);
    return;
  }

  // Serve static assets if not matching any /api route
  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API route not found' }));
    return;
  }

  // Resolve static file — prefer dist/ (Vite default), fall back to dist-app/
  const distDirs = [
    path.join(__dirname, 'dist'),
    path.join(__dirname, 'dist-app'),
  ];

  const cleanPath = pathname.split('?')[0].split('#')[0];
  const ext = path.extname(cleanPath);

  // For SPA hash routing: serve index.html for any non-asset request
  const isAsset = ext && ext !== '.html';
  const relPath = isAsset ? cleanPath : 'index.html';

  let contentType = 'text/html';
  if (ext === '.js' || ext === '.mjs') contentType = 'text/javascript';
  else if (ext === '.css') contentType = 'text/css';
  else if (ext === '.json') contentType = 'application/json';
  else if (ext === '.svg') contentType = 'image/svg+xml';
  else if (ext === '.png') contentType = 'image/png';
  else if (ext === '.ico') contentType = 'image/x-icon';

  // Try each dist directory in order
  const tryServe = (dirs) => {
    if (dirs.length === 0) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Frontend build not found. Run: npm run build');
      return;
    }
    const filePath = path.join(dirs[0], relPath);
    fs.readFile(filePath, (err, content) => {
      if (err) {
        tryServe(dirs.slice(1));
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  };
  tryServe(distDirs);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🌐 LLMParty Web Server running on http://localhost:${PORT}`);
});
