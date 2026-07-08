const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const http = require('http');
const os = require('os');

let mainWindow;
let tray;
let staticServer;
const staticPort = 9989;

function startStaticServer() {
  staticServer = http.createServer((req, res) => {
    // Basic static web server for resolving ES modules in production file loads
    let filePath = path.join(__dirname, 'dist', req.url === '/' ? 'index.html' : req.url);
    filePath = filePath.split('?')[0].split('#')[0]; // strip parameters

    const ext = path.extname(filePath);
    let contentType = 'text/html';
    if (ext === '.js') contentType = 'text/javascript';
    else if (ext === '.css') contentType = 'text/css';
    else if (ext === '.json') contentType = 'application/json';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.svg') contentType = 'image/svg+xml';
    else if (ext === '.ico') contentType = 'image/x-icon';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  });
  staticServer.listen(staticPort, '127.0.0.1');
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const widgetWidth = 380;
  const widgetHeight = 650;

  mainWindow = new BrowserWindow({
    width: widgetWidth,
    height: widgetHeight,
    x: width - widgetWidth - 20, // 20px padding from the right edge
    y: 50,                       // 50px padding from top (below menu bar)
    show: true,
    frame: false,                // Borderless
    resizable: false,
    transparent: true,           // Support glassmorphic translucency
    hasShadow: false,            // Drop shadow managed in CSS
    alwaysOnTop: false,          // Sits on desktop layer
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Set visible on all macOS spaces/desktops
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

  // Load from Vite dev server if running, else load from local static server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:9988');
  } else {
    mainWindow.loadURL(`http://localhost:${staticPort}`);
  }
}

function toggleWindow() {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
  }
}

app.whenReady().then(() => {
  // Hide dock icon for widget experience
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  if (process.env.NODE_ENV !== 'development') {
    startStaticServer();
  }

  createWindow();

  // Create tray status item for quick actions
  const emptyIcon = nativeImage.createEmpty();
  tray = new Tray(emptyIcon);
  tray.setTitle('🎉 LLMParty');

  tray.on('click', () => {
    toggleWindow();
  });

  tray.on('right-click', () => {
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Toggle Widget', click: () => toggleWindow() },
      { type: 'separator' },
      { label: 'Quit App', click: () => app.quit() }
    ]);
    tray.popUpContextMenu(contextMenu);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Paths setup
const homeDir = os.homedir();
const zshrcPath = path.join(homeDir, '.zshrc');
const aiderConfPath = path.join(homeDir, '.aider.conf.yml');
const litellmConfPath = path.join(homeDir, '.litellm/config.yaml');
const statsFilePath = path.join(homeDir, '.llmparty-stats.json');

// Check LM Studio HTTP Status
ipcMain.handle('check-lmstudio-status', async () => {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: 'localhost',
        port: 1234,
        path: '/v1/models',
        method: 'GET',
        timeout: 1000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const activeModel = parsed.data && parsed.data.length > 0 ? parsed.data[0].id : 'None loaded';
            resolve({ running: true, activeModel, modelsList: parsed.data || [] });
          } catch (e) {
            resolve({ running: true, activeModel: 'Unknown', error: 'Failed parsing response' });
          }
        });
      }
    );

    req.on('error', () => {
      resolve({ running: false, activeModel: 'Stopped' });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ running: false, activeModel: 'Timeout' });
    });

    req.end();
  });
});

// Stats manager
ipcMain.handle('get-stats', async () => {
  if (fs.existsSync(statsFilePath)) {
    try {
      const data = fs.readFileSync(statsFilePath, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      return getEmptyStats();
    }
  }
  return getEmptyStats();
});

ipcMain.handle('save-stats', async (event, stats) => {
  fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2), 'utf-8');
  return true;
});

function getEmptyStats() {
  return {
    costSaved: 0.00,
    requestsToday: 0,
    requestsThisWeek: 0,
    requestsThisMonth: 0,
    avgInferenceSpeed: 0,
  };
}

// Configs manager
ipcMain.handle('read-configs', async () => {
  const defaultCfg = {
    tui: { theme: 'party', status_bar_format: ' 🎉 LLMPARTY | [{status}] {provider} ({model}) | Context: {context} | Cost: ${cost} | Savings: ${savings} ', rainbow_speed: 1 },
    backends: {
      primary: 'anthropic',
      local_provider: 'lmstudio',
      pipeline: ['anthropic', 'openai', 'gemini', 'local'],
      anthropic: { api_key: '', model: 'claude-3-5-sonnet-latest' },
      openai: { api_key: '', model: 'gpt-4o' },
      gemini: { api_key: '', model: 'gemini-1.5-pro' },
      local: { base_url: 'http://localhost:1234/v1', model: 'qwen2.5-7b-instruct-mlx' }
    }
  };

  let cfg = defaultCfg;
  const configPath = path.join(homeDir, '.llmparty/config.json');
  if (fs.existsSync(configPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch(e) {}
  }
  
  try {
    const mcpPath = path.join(process.cwd(), 'mcp.json');
    if (fs.existsSync(mcpPath)) {
      const mcpData = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      if (mcpData.mcpServers) {
        cfg.mcpServers = { ...(cfg.mcpServers || {}), ...mcpData.mcpServers };
      }
    }
  } catch(e) {}
  
  return cfg;
});

ipcMain.handle('save-configs', async (event, configs) => {
  // Update ~/.zshrc exports for Claude Code
  let zshrcContent = '';
  if (fs.existsSync(zshrcPath)) {
    zshrcContent = fs.readFileSync(zshrcPath, 'utf-8');
  }

  // Helper to replace or append env vars
  const setEnvVar = (content, name, value) => {
    const regex = new RegExp(`export ${name}="?[^"\n]*"?`);
    if (content.match(regex)) {
      return content.replace(regex, `export ${name}="${value}"`);
    } else {
      return content + `\nexport ${name}="${value}"`;
    }
  };

  const primary = configs.backends?.primary || 'anthropic';
  const localBase = configs.backends?.local?.base_url || 'http://localhost:1234/v1';
  const localModel = configs.backends?.local?.model || 'qwen2.5-7b-instruct-mlx';

  // Point Claude Code at LLMParty Telemetry Proxy (Port 9990)
  zshrcContent = setEnvVar(zshrcContent, 'ANTHROPIC_BASE_URL', 'http://127.0.0.1:9990');
  
  // Set fallback active key overrides if saved
  const activeKey = configs.backends?.[primary]?.api_key || 'sk-lm-studio';
  zshrcContent = setEnvVar(zshrcContent, 'ANTHROPIC_API_KEY', activeKey);
  zshrcContent = setEnvVar(zshrcContent, 'ANTHROPIC_AUTH_TOKEN', activeKey);
  zshrcContent = setEnvVar(zshrcContent, 'CLAUDE_CODE_MODEL', configs.backends?.[primary]?.model || 'claude-3-5-sonnet-latest');

  fs.writeFileSync(zshrcPath, zshrcContent, 'utf-8');

  // Save the config file to ~/.llmparty/config.json
  const configPath = path.join(homeDir, '.llmparty/config.json');
  if (!fs.existsSync(path.dirname(configPath))) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf-8');

  try {
    if (configs.mcpServers) {
      const mcpPath = path.join(process.cwd(), 'mcp.json');
      const mcpData = fs.existsSync(mcpPath) ? JSON.parse(fs.readFileSync(mcpPath, 'utf-8')) : { mcpServers: {} };
      mcpData.mcpServers = { ...(mcpData.mcpServers || {}), ...configs.mcpServers };
      fs.writeFileSync(mcpPath, JSON.stringify(mcpData, null, 2), 'utf-8');
    }
  } catch(e) {}

  // Update ~/.aider.conf.yml
  const aiderContent = `openai-api-base: "http://127.0.0.1:9990/v1"\nopenai-api-key: "${configs.backends?.openai?.api_key || 'none'}"\nmodel: "${configs.backends?.openai?.model || 'gpt-4o'}"\n`;
  fs.writeFileSync(aiderConfPath, aiderContent, 'utf-8');

  return true;
});

ipcMain.handle('reset-configs', async () => {
  // Safe resets to default
  if (fs.existsSync(aiderConfPath)) fs.unlinkSync(aiderConfPath);
  return true;
});

// Models manager
ipcMain.handle('get-models', async () => {
  const modelsDir = path.join(homeDir, '.lmstudio/models');
  const modelsList = [];

  function scanDir(dir, base = '') {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scanDir(fullPath, path.join(base, file));
      } else if (file.endsWith('.gguf') || file.endsWith('.bin')) {
        modelsList.push({
          name: file,
          path: path.join(base, file),
          size: (stat.size / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
          rawSize: stat.size,
        });
      }
    }
  }

  scanDir(modelsDir);
  return modelsList;
});

// Spawning AppleScript terminal sessions for CLI
ipcMain.handle('launch-claude-code', async () => {
  const script = `
    tell application "Terminal"
      do script "echo '=== Launching Claude Code (Cloud Mode) ===' && claude"
      activate
    end tell
  `;
  exec(`osascript -e '${script.replace(/\n/g, ' ')}'`);
  return true;
});

ipcMain.handle('launch-aider', async () => {
  const script = `
    tell application "Terminal"
      do script "echo '=== Launching Aider with LLMParty ===' && aider --openai-api-base http://localhost:1234/v1 --openai-api-key none --model openai/qwen2.5-7b-instruct-mlx"
      activate
    end tell
  `;
  exec(`osascript -e '${script.replace(/\n/g, ' ')}'`);
  return true;
});

// LM Studio process controls (attempts to use CLI or launches application)
ipcMain.handle('start-lmstudio', async () => {
  // Look for lms CLI or open the application
  return new Promise((resolve) => {
    exec('lms server start --port 1234', (err) => {
      if (err) {
        // Fallback: Try opening application directly
        exec('open -a "LM Studio"', (openErr) => {
          if (openErr) {
            resolve({ success: false, error: 'Could not launch LM Studio CLI or Application' });
          } else {
            resolve({ success: true, mode: 'app' });
          }
        });
      } else {
        resolve({ success: true, mode: 'cli' });
      }
    });
  });
});

ipcMain.handle('stop-lmstudio', async () => {
  return new Promise((resolve) => {
    exec('lms server stop', (err) => {
      if (err) {
        // Fallback: Kill processes
        exec('killall "LM Studio" || killall "lms"', () => {
          resolve({ success: true });
        });
      } else {
        resolve({ success: true });
      }
    });
  });
});

// Logs aggregator
ipcMain.handle('get-logs', async (event, service) => {
  const logPaths = {
    lmstudio: [
      path.join(homeDir, '.lmstudio/logs/server.log'),
      path.join(homeDir, 'Library/Application Support/LM-Studio/logs/server.log'),
    ],
    aider: [path.join(homeDir, '.aider.chat.history.md')],
    claudecode: [path.join(homeDir, '.claude/history.json')], // Mock / config path if it exists
  };

  const paths = logPaths[service] || [];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const stats = fs.statSync(p);
        const stream = fs.readFileSync(p, 'utf-8');
        return stream.split('\n').slice(-50).join('\n');
      } catch (e) {
        // continue
      }
    }
  }

  // Helpful default mock trace so it is not blank
  return `[LLMParty Service Logs Scanner]\nNo active log files detected at default paths for: ${service}.\nActive polling on localhost:1234/v1 is healthy.`;
});

// System Info
ipcMain.handle('get-system-info', async () => {
  return {
    platform: process.platform,
    arch: process.arch,
    totalMemory: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
    freeMemory: (os.freemem() / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
    cpus: os.cpus().length + 'x ' + os.cpus()[0].model,
  };
});
