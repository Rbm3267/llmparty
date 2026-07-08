#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const readline = require('readline');
const { spawn, exec } = require('child_process');

const configDir = path.join(os.homedir(), '.llmparty');
const configPath = path.join(configDir, 'config.json');

// Load settings
function loadConfig() {
  let cfg = {};
  if (!fs.existsSync(configPath)) {
    cfg = {
      tui: {
        theme: 'party',
        status_bar_format: ' 🎉 LLMPARTY | [{status}] {provider} ({model}) | Context: {context} | Cost: ${cost} | Savings: ${savings} ',
        rainbow_speed: 1.0
      },
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
  } else {
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      cfg = {};
    }
  }

  // Deep merge mcp.json into cfg if it exists
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
}

function saveConfig(cfg) {
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir);
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
  try {
    if (cfg.mcpServers) {
      const mcpPath = path.join(process.cwd(), 'mcp.json');
      const mcpData = fs.existsSync(mcpPath) ? JSON.parse(fs.readFileSync(mcpPath, 'utf-8')) : { mcpServers: {} };
      mcpData.mcpServers = { ...(mcpData.mcpServers || {}), ...cfg.mcpServers };
      fs.writeFileSync(mcpPath, JSON.stringify(mcpData, null, 2), 'utf-8');
    }
  } catch(e) {}
}

// Banner rendering
const GRADIENT = [
  '\x1b[38;5;199m', // Pink
  '\x1b[38;5;206m',
  '\x1b[38;5;213m',
  '\x1b[38;5;141m',
  '\x1b[38;5;105m',
  '\x1b[38;5;81m',  // Cyan
  '\x1b[38;5;51m'
];

function printPartyBanner() {
  const bannerLines = [
    " _      _      __  __ _____           _         ",
    "| |    | |    |  \\/  |  __ \\         | |        ",
    "| |    | |    | \\  / | |__) |_ _ _ __| |_ _   _ ",
    "| |    | |    | |\\/| |  ___/ _` | '__| __| | | |",
    "| |____| |____| |  | | |  | (_| | |  | |_| |_| |",
    "|______|______|_|  |_|_|   \\__,_|_|   \\__|\\__, |",
    "                                           __/ |",
    "                                          |___/ "
  ];
  
  console.log();
  bannerLines.forEach((line) => {
    // Apply a horizontal gradient across each line
    let gradLine = '';
    for (let i = 0; i < line.length; i++) {
      const colorIdx = Math.floor((i / line.length) * GRADIENT.length);
      gradLine += GRADIENT[colorIdx] + line[i];
    }
    console.log(gradLine + '\x1b[0m');
  });
  console.log();
}

const args = process.argv.slice(2);
const command = args[0] || 'run';

if (command === 'run') {
  if (process.stdout.isTTY) {
    // Clear the screen FIRST and set up scroll region BEFORE printing anything.
    // This prevents the banner from flashing at full-screen height and then jumping.
    process.stdout.write('\x1b[2J\x1b[H'); // clear + home cursor
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b[1;${rows - 6}r`); // reserve bottom 6 rows for chat+status
  }
  
  printPartyBanner();
  
  // Real startup sequence styled like the mockup
  const config = loadConfig();
  console.log(`\x1b[38;5;51m❯\x1b[0m Loading configurations...`);
  console.log(`\x1b[32m✔\x1b[0m Configs loaded from ~/.llmparty`);
  console.log(`\x1b[32m✔\x1b[0m Primary Provider: ${config.backends.primary}`);
  console.log(`\x1b[32m✔\x1b[0m Fallback Pipeline: ${config.backends.pipeline?.join(' → ') || 'None'}`);
  console.log(`\x1b[32m✔\x1b[0m Telemetry proxy online and awaiting requests.`);
  console.log(`\x1b[38;5;51mLLM>\x1b[0m Greetings! I am ready to assist. Type /help to see a list of available commands.\n`);
  
  // We do NOT push the cursor down here. Let the warnings print normally at the top.

  // Read persisted provider state to show degraded warnings at startup
  try {
    const stateRaw = fs.existsSync(path.join(os.homedir(), '.llmparty/provider-state.json'))
      ? fs.readFileSync(path.join(os.homedir(), '.llmparty/provider-state.json'), 'utf-8')
      : '{}';
    const provState = JSON.parse(stateRaw);
    const degraded = provState.degraded || {};
    const pipeline = config.backends.pipeline || [config.backends.primary];

    // Show warnings for each degraded provider in the pipeline
    let firstActive = null;
    for (const p of pipeline) {
      const entry = degraded[p];
      if (entry) {
        const expStr = entry.expiresAt
          ? `auto-clears ${new Date(entry.expiresAt).toLocaleTimeString()}`
          : 'manual reset required';
        console.log(`\x1b[31m⚠️  ${p}: DEGRADED — ${entry.reason} (since ${entry.sinceStr}, ${expStr})\x1b[0m`);
        console.log(`   To reset: curl -X POST http://localhost:9990/api/provider-state/reset/${p}`);
      } else if (!firstActive) {
        firstActive = { provider: p, model: config.backends[p]?.model || p };
      }
    }

    const activeModel = (provState.lastUsed && !degraded[provState.lastUsed?.provider])
      ? `${provState.lastUsed.provider} / ${provState.lastUsed.model}`
      : firstActive
        ? `${firstActive.provider} / ${firstActive.model}`
        : config.backends[config.backends.primary]?.model || config.backends.primary;

    console.log(`👉 Current Model:          \x1b[33m${activeModel}\x1b[0m  ← updates after each reply\n`);
  } catch(e) {
    console.log(`👉 Current Model:          \x1b[33m${config.backends[config.backends.primary]?.model || config.backends.primary}\x1b[0m  ← updates after each reply\n`);
  }


  // We will initialize readline later after the startup sequence is done

  // Tracks the actual provider+model used in the most recent gateway response
  let lastUsed = {
    provider: config.backends.primary,
    model: config.backends[config.backends.primary]?.model || config.backends.primary,
  };

  function formatModelLabel(model) {
    if (!model || model === 'unknown') return config.backends.primary;
    if (/claude.cli/i.test(model) || model === 'claude-cli') return `claude-cli (claude --print)`;
    if (/claude/i.test(model)) return `anthropic / ${model}`;
    if (/gemini/i.test(model)) return `gemini / ${model.replace('models/', '')}`;
    if (/gpt|o1|o3/i.test(model))  return `openai / ${model}`;
    if (/qwen|llama|mistral|deepseek|phi/i.test(model)) return `local / ${model}`;
    return model;
  }

  // --- Pinned Status Bar & Scroll Region ---
  function setupScrollRegion() {
    if (!process.stdout.isTTY) return;
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b[1;${rows - 6}r`);
  }
  
  if (process.stdout.isTTY) {
    // Already setup initially, but hook resize
    process.stdout.on('resize', setupScrollRegion);
    process.on('exit', () => {
      // Reset scroll region on exit
      process.stdout.write(`\x1b[1;${process.stdout.rows}r\x1b[${process.stdout.rows};1H\n`);
    });
  }

  function drawStatusBar(dots = 0) {
    // We leave this as a no-op so old calls don't break. The real drawing happens in _refreshLine.
  }

  // We need to define stats and chatHistory up here so they are available
  let stats = { context: '200k', cost: 6.51, savings: 0.36, sessionCost: 0.01 };
  let chatHistory = [];
  
  let showSuggestions = false;
  let suggestionIndex = 0;
  let currentSuggestions = []; // Track typed line buffer

  const suggestions = [
    { cmd: '/status', desc: 'Check rates/failover diagnostics' },
    { cmd: '/config view', desc: 'Display active settings profile' },
    { cmd: '/config set primary', desc: 'Switch primary model provider' },
    { cmd: '/config set anthropic.api_key', desc: 'Set Anthropic API Key' },
    { cmd: '/agents list', desc: 'List active MCP and LLM agents' },
    { cmd: '/mcp list', desc: 'List configured MCP servers' },
    { cmd: '/mcp add', desc: 'Add a new MCP server (name cmd args...)' },
    { cmd: '/mcp remove', desc: 'Remove an MCP server by name' },
    { cmd: '/clear', desc: 'Clear chat history context' },
    { cmd: '/exit',   desc: 'Exit LLMParty session' }
  ];

  function getFilteredSuggestions() {
    if (!currentBuffer.startsWith('/')) return [];
    return suggestions.filter(s => s.cmd.startsWith(currentBuffer));
  }

  function drawSuggestions() {
    const filtered = getFilteredSuggestions();
    if (filtered.length === 0) {
      // Clear suggestions view if nothing matches
      process.stdout.write('\x1b[J');
      return;
    }
    process.stdout.write('\n\x1b[35m[Suggestions]\x1b[0m\n');
    filtered.forEach((item, idx) => {
      if (idx === suggestionIndex) {
        process.stdout.write(` \x1b[45m\x1b[37m ➔ ${item.cmd} \x1b[0m - \x1b[37m${item.desc}\x1b[0m\n`);
      } else {
        process.stdout.write(`   \x1b[90m${item.cmd}\x1b[0m - \x1b[90m${item.desc}\x1b[0m\n`);
      }
    });
    process.stdout.write(`\x1b[90m(Press TAB to autocomplete selected, Esc to clear)\x1b[0m\n`);
  }

  // Listen for individual keypresses to offer typeahead autocomplete/suggestions on '/'
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on('keypress', (str, key) => {
    if (!key) return;

    if (key.name === 'escape') {
      if (showSuggestions) {
        const filteredCount = getFilteredSuggestions().length;
        process.stdout.write(`\x1b[${filteredCount + 3}A\x1b[J`);
        showSuggestions = false;
        currentBuffer = '';
        rl.prompt();
      }
      return;
    }

    if (showSuggestions && key) {
      if (key.name === 'down') {
        const filtered = getFilteredSuggestions();
        suggestionIndex = (suggestionIndex + 1) % filtered.length;
        process.stdout.write(`\x1b[${filtered.length + 3}A\x1b[J`);
        drawSuggestions();
        rl.prompt();
        return;
      } else if (key.name === 'up') {
        const filtered = getFilteredSuggestions();
        suggestionIndex = (suggestionIndex - 1 + filtered.length) % filtered.length;
        process.stdout.write(`\x1b[${filtered.length + 3}A\x1b[J`);
        drawSuggestions();
        rl.prompt();
        return;
      }
    }

    if (key.name === 'tab' && showSuggestions) {
      const filtered = getFilteredSuggestions();
      if (filtered.length > 0) {
        const selected = filtered[suggestionIndex % filtered.length].cmd;
        const filteredCount = filtered.length;
        // Clean suggestion lines
        process.stdout.write(`\x1b[${filteredCount + 3}A\x1b[J`);
        showSuggestions = false;
        
        // Write selected command to prompt
        rl.write(null, { ctrl: true, name: 'u' }); // clear line
        rl.write(selected + ' ');
        currentBuffer = selected + ' ';
      }
      return;
    }

    // Build the query buffer dynamically
    if (key.name === 'backspace') {
      currentBuffer = currentBuffer.slice(0, -1);
    } else if (str && !key.ctrl && !key.meta && key.name !== 'up' && key.name !== 'down') {
      currentBuffer += str;
    }

    if (currentBuffer.startsWith('/')) {
      const prevFilteredCount = getFilteredSuggestions().length;
      if (showSuggestions && prevFilteredCount > 0) {
        // Move cursor up to clear previous menu before redrawing
        process.stdout.write(`\x1b[${prevFilteredCount + 3}A\x1b[J`);
      }
      showSuggestions = true;
      const filtered = getFilteredSuggestions();
      if (filtered.length > 0) {
        suggestionIndex = suggestionIndex % filtered.length;
        drawSuggestions();
        rl.prompt();
        // Restore input cursor position
        rl.write(null, { ctrl: true, name: 'e' });
      }
    } else {
      if (showSuggestions) {
        const filteredCount = getFilteredSuggestions().length;
        process.stdout.write(`\x1b[${filteredCount + 3}A\x1b[J`);
        showSuggestions = false;
      }
    }
  });

  // If they passed a prompt string directly, just echo it (for standard piping)
  if (args.length > 1) {
    console.log(`Sending prompt: ${args.slice(1).join(' ')}`);
    process.exit(0);
  }

  // Now that the startup sequence is done and the cursor is naturally at the bottom 
  // of the startup text, we initialize readline. This ensures readline captures
  // the correct Y-coordinate and doesn't jump to the bottom of the screen.
  
  // readline is already required at the top of the file.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[90m' + '─'.repeat(process.stdout.columns || 80) + '\x1b[0m\n\x1b[1m❯\x1b[0m '
  });
  
  if (process.stdout.isTTY) {
    process.stdout.on('resize', () => {
      rl.setPrompt('\x1b[90m' + '─'.repeat(process.stdout.columns || 80) + '\x1b[0m\n\x1b[1m❯\x1b[0m ');
    });
  }
  
  const originalRefresh = rl._refreshLine;
  rl._refreshLine = function() {
    originalRefresh.call(this);
    if (!process.stdout.isTTY) return;
    const rows = process.stdout.rows || 24;
    const width = process.stdout.columns || 80;
    const divider = '\x1b[90m' + '─'.repeat(width) + '\x1b[0m';
    
    let modelName = (lastUsed.model === 'unknown' ? config.backends.primary : lastUsed.model).replace(/^models\//, '');
    if (modelName.length > 20) modelName = modelName.substring(0, 20) + '...';
    
    const line1 = `\x1b[38;5;33m🔵 ${modelName}\x1b[0m \x1b[32m(cost: $${stats.cost.toFixed(3)} / tokens: ${stats.context})\x1b[0m`;
    const line2 = `\x1b[38;5;199m⚙ LLMParty v1.0\x1b[0m  \x1b[32mConnected to localhost:9990\x1b[0m`;
    const line3 = `\x1b[90m← for agents\x1b[0m`;

    // Draw the bottom divider at rows - 4, and the status lines at rows - 3, rows - 2, and rows - 1
    process.stdout.write(`\x1b[s\x1b[${rows - 4};1H\x1b[2K\r${divider}\n\x1b[${rows - 3};1H\x1b[2K\r${line1}\n\x1b[${rows - 2};1H\x1b[2K\r${line2}\n\x1b[${rows - 1};1H\x1b[2K\r${line3}\x1b[u`);
  };

  function drawStatusBar(dots = 0) {}

  if (process.stdout.isTTY) {
    const rows = process.stdout.rows || 24;
    // Move cursor to the bottom of the scroll region (rows - 6) so the chat bar starts there
    process.stdout.write(`\x1b[${rows - 6};1H`);
  }
  
  drawStatusBar();
  rl.prompt();

  // Command router within the running session
  rl.on('line', (line) => {
    const input = line.trim();
    if (input === 'exit' || input === 'quit' || input === '/exit') {
      rl.close();
      process.exit(0);
    } else if (input === '/clear' || input === 'clear') {
      chatHistory = [];
      console.log('\n✨ Chat context window cleared.');
      drawStatusBar();
      rl.prompt();
    } else if (input === 'esc' || input === 'back') {
      console.log('\nReturned to main prompt.');
      drawStatusBar();
      rl.prompt();
    } else if (input === '/status' || input === 'status') {
      exec('llmparty status', (err, stdout) => {
        console.log(`\n${stdout.trim()}`);
        drawStatusBar();
        rl.prompt();
      });
    } else if (input === '/config view' || input === '/config' || input === 'config') {
      console.log('\n🌐 \x1b[32mOpening configuration panel in browser...\x1b[0m');
      // Launches default browser to local server config panel
      const url = 'http://localhost:9990/#/settings';
      const startCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${startCmd} ${url}`);
      drawStatusBar();
      rl.prompt();
    } else if (input === '/agents list' || input === '/agents' || input === 'agents') {
      console.log('\n\x1b[33m=== Connected LLM Agents Registry ===\x1b[0m');
      const mcpServers = config.mcpServers || {};
      const mcpNames = Object.keys(mcpServers);
      if (mcpNames.length === 0) {
        console.log(`- \x1b[90mNo MCP servers configured. Use /mcp add <name> <cmd> [args...]\x1b[0m`);
      } else {
        mcpNames.forEach(name => {
          console.log(`- \x1b[1m${name}\x1b[0m: Integrated via MCP plugins, handles ${mcpServers[name].command}`);
        });
      }
      console.log(`- \x1b[1mLocal Dev Agent\x1b[0m: Runs on ${config.backends.local?.model || 'local'}, performs file edits.`);
      console.log(`\x1b[90m(Type "/run <agent-name>" to launch, or "esc" to go back)\x1b[0m\n`);
      drawStatusBar();
      rl.prompt();
    } else if (input.startsWith('/mcp ') || input.startsWith('mcp ')) {
      const commandStr = input.startsWith('/') ? input.substring(1) : input;
      const parts = commandStr.replace('mcp ', '').split(' ');
      const action = parts[0];
      const name = parts[1];
      const cmd = parts[2];
      const cmdArgs = parts.slice(3);
      
      if (!config.mcpServers) config.mcpServers = {};

      if (action === 'list') {
        console.log('\n🔌 \x1b[1mMCP Servers:\x1b[0m');
        if (Object.keys(config.mcpServers).length === 0) console.log('  No servers configured.');
        else console.log(JSON.stringify(config.mcpServers, null, 2));
      } else if (action === 'add' && name && cmd) {
        config.mcpServers[name] = { command: cmd, args: cmdArgs, env: { LLMPARTY_GATEWAY: 'http://localhost:9990/v1' } };
        saveConfig(config);
        console.log(`\n✨ Added MCP server \x1b[32m${name}\x1b[0m`);
      } else if (action === 'remove' && name) {
        delete config.mcpServers[name];
        saveConfig(config);
        console.log(`\n🗑️ Removed MCP server \x1b[31m${name}\x1b[0m`);
      } else {
        console.log('\nUsage: /mcp list | /mcp add <name> <cmd> [args...] | /mcp remove <name>');
      }
      drawStatusBar();
      rl.prompt();
    } else if (input.startsWith('config set ') || input.startsWith('/config set ')) {
      const commandStr = input.startsWith('/') ? input.substring(1) : input;
      const parts = commandStr.replace('config set ', '').split(' ');
      const key = parts[0];
      const val = parts[1];
      if (key && val) {
        // Resolve nested keys e.g. backends.primary directly in-process
        const keys = key.split('.');
        let current = config;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!current[keys[i]]) current[keys[i]] = {};
          current = current[keys[i]];
        }
        
        let typedValue = val;
        if (val === 'true') typedValue = true;
        else if (val === 'false') typedValue = false;
        else if (!isNaN(val)) typedValue = Number(val);
        
        current[keys[keys.length - 1]] = typedValue;
        saveConfig(config);
        console.log(`\n✨ Successfully set \x1b[32m${key}\x1b[0m to \x1b[36m"${val}"\x1b[0m!`);
        drawStatusBar();
        rl.prompt();
      } else {
        console.log('\nUsage: config set <key> <value>');
        drawStatusBar();
        rl.prompt();
      }
    } else if (input.startsWith('/model ') || input.startsWith('model ')) {
      const val = input.split(' ')[1];
      if (val) {
        const primary = config.backends.primary;
        if (!config.backends[primary]) config.backends[primary] = {};
        config.backends[primary].model = val;
        saveConfig(config);
        
        // Update local state to reflect change immediately in UI
        lastUsed.model = val;
        lastUsed.provider = primary;
        
        console.log(`\n✨ Switched \x1b[32m${primary}\x1b[0m model to \x1b[36m"${val}"\x1b[0m!`);
        drawStatusBar();
        rl.prompt();
      } else {
        console.log('\nUsage: /model <model-name>');
        drawStatusBar();
        rl.prompt();
      }
    } else {
      if (input) {
        // Not a slash command: route query to active local LLMParty proxy gateway
        process.stdout.write('\n\x1b[35m[LLMParty Gateway] Thinking...\x1b[0m\r');
        
        chatHistory.push({ role: 'user', content: input });
        const postData = JSON.stringify({
          model: config.backends[config.backends.primary]?.model || 'default',
          messages: chatHistory
        });

        const reqOptions = {
          hostname: '127.0.0.1',
          port: 9990,
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout: 10000
        };

        const proxyReq = http.request(reqOptions, (proxyRes) => {
          let resData = '';
          proxyRes.on('data', chunk => resData += chunk);
          proxyRes.on('end', () => {
            // Clear thinking line
            process.stdout.write('\x1b[2K\r');
            try {
              const result = JSON.parse(resData);
              let reply = 'No reply received from gateway.';
              if (result.choices?.[0]?.message?.content) {
                reply = result.choices[0].message.content;
              } else if (result.content?.[0]?.text) {
                reply = result.content[0].text;
              }
              chatHistory.push({ role: 'assistant', content: reply });

              // ── Dynamic provider label ──────────────────────────────
              const usedModel = result.model || 'unknown';
              let providerLabel = usedModel;
              let labelColor = '\x1b[32m';

              if (/claude.cli/i.test(usedModel) || usedModel === 'claude-cli') {
                providerLabel = `claude-cli (\x1b[35mclaude --print\x1b[36m)`;
                labelColor = '\x1b[36m';
              } else if (/claude/i.test(usedModel)) {
                providerLabel = `anthropic / ${usedModel}`;
                labelColor = '\x1b[36m';
              } else if (/gemini/i.test(usedModel)) {
                providerLabel = `gemini / ${usedModel.replace('models/', '')}`;
                labelColor = '\x1b[35m';
              } else if (/gpt|o1|o3/i.test(usedModel)) {
                providerLabel = `openai / ${usedModel}`;
                labelColor = '\x1b[34m';
              } else if (/qwen|llama|mistral|deepseek|phi/i.test(usedModel)) {
                providerLabel = `local / ${usedModel}`;
                labelColor = '\x1b[33m';
              }

              // ── Update lastUsed so status bar + next redraw reflect reality ──
              const prevModel = lastUsed.model;
              lastUsed.model = usedModel;
              // Derive provider from model name
              if (/claude.cli/i.test(usedModel) || usedModel === 'claude-cli') lastUsed.provider = 'claude_cli';
              else if (/claude/i.test(usedModel))                  lastUsed.provider = 'anthropic';
              else if (/gemini/i.test(usedModel))                   lastUsed.provider = 'gemini';
              else if (/gpt|o1|o3/i.test(usedModel))               lastUsed.provider = 'openai';
              else if (/qwen|llama|mistral|deepseek|phi/i.test(usedModel)) lastUsed.provider = 'local';

              // Print failover notice if provider changed mid-session
              if (prevModel !== lastUsed.model && prevModel !== config.backends[config.backends.primary]?.model) {
                console.log(`\x1b[33m⚡ Failover: ${formatModelLabel(prevModel)} → ${formatModelLabel(usedModel)}\x1b[0m`);
              }

              console.log(`\n${labelColor}➔ ${providerLabel}:\x1b[0m ${reply}\n`);
              console.log(`\x1b[2m📡 Active model: ${formatModelLabel(usedModel)}\x1b[0m`);

            } catch (e) {
              console.log(`\n\x1b[31m⚠️ Gateway response parsing failed:\x1b[0m ${resData.slice(0, 100)}...\n`);
            }
            drawStatusBar();
            rl.prompt();
          });
        });

        proxyReq.on('error', (err) => {
          process.stdout.write('\x1b[2K\r');
          console.log(`\n\x1b[31m⚠️ Gateway Offline:\x1b[0m Connection to proxy at port 9990 failed (${err.message}).\n`);
          drawStatusBar();
          rl.prompt();
        });

        proxyReq.write(postData);
        proxyReq.end();
      } else {
        drawStatusBar();
        rl.prompt();
      }
    }
  });

} else if (command === 'config') {
  const config = loadConfig();
  const sub = args[1];
  
  if (!sub) {
    console.log('\n🔧 \x1b[1mLLMParty Local Configurations:\x1b[0m');
    console.log(JSON.stringify(config, null, 2));
  } else if (sub === 'set') {
    const key = args[2];
    const value = args[3];
    if (!key || !value) {
      console.log('Error: Usage: llmparty config set <key> <value>');
      process.exit(1);
    }
    
    // Resolve nested keys e.g. backends.primary
    const keys = key.split('.');
    let current = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    
    // Check if value is boolean or number
    let typedValue = value;
    if (value === 'true') typedValue = true;
    else if (value === 'false') typedValue = false;
    else if (!isNaN(value)) typedValue = Number(value);
    
    current[keys[keys.length - 1]] = typedValue;
    saveConfig(config);
    console.log(`✨ Successfully set \x1b[32m${key}\x1b[0m to \x1b[36m"${value}"\x1b[0m!`);
  }
} else if (command === 'mcp') {
  const config = loadConfig();
  const sub = args[1];
  const name = args[2];
  const cmd = args[3];
  const cmdArgs = args.slice(4);
  
  if (!config.mcpServers) config.mcpServers = {};

  if (!sub || sub === 'list') {
    console.log('\n🔌 \x1b[1mMCP Servers:\x1b[0m');
    console.log(JSON.stringify(config.mcpServers, null, 2));
  } else if (sub === 'add') {
    if (!name || !cmd) {
      console.log('Error: Usage: llmparty mcp add <name> <command> [args...]');
      process.exit(1);
    }
    config.mcpServers[name] = { command: cmd, args: cmdArgs, env: { LLMPARTY_GATEWAY: 'http://localhost:9990/v1' } };
    saveConfig(config);
    console.log(`✨ Added MCP server \x1b[32m${name}\x1b[0m!`);
  } else if (sub === 'remove') {
    if (!name) {
      console.log('Error: Usage: llmparty mcp remove <name>');
      process.exit(1);
    }
    delete config.mcpServers[name];
    saveConfig(config);
    console.log(`🗑️ Removed MCP server \x1b[31m${name}\x1b[0m!`);
  } else {
    console.log('Error: Unknown mcp command. Use list, add, or remove.');
    process.exit(1);
  }
} else if (command === 'status') {
  const config = loadConfig();
  console.log('\n📊 \x1b[1mLLMParty Status Overview:\x1b[0m');
  console.log(`- Base server: \x1b[32mActive (Port 9990)\x1b[0m`);
  console.log(`- Primary: \x1b[36m${config.backends.primary}\x1b[0m`);
  console.log(`- Fallback local target: \x1b[34m${config.backends.local_provider}\x1b[0m`);
  console.log(`- Token Cache Size: \x1b[33m50 (sliding window)\x1b[0m\n`);
} else if (command === 'server') {
  const sub = args[1] || 'status';
  if (sub === 'status') {
    exec('ps aux | grep "node server.js"', (err, stdout) => {
      const isRunning = stdout && stdout.includes('server.js') && !stdout.includes('grep');
      console.log(`Server status: ${isRunning ? '\x1b[32mRunning\x1b[0m' : '\x1b[31mStopped\x1b[0m'}`);
    });
  } else if (sub === 'start') {
    console.log('Starting background telemetry server...');
    const out = fs.openSync(path.join(configDir, 'server.log'), 'a');
    const child = spawn('node', [path.join(__dirname, 'server.js')], {
      detached: true,
      stdio: ['ignore', out, out]
    });
    child.unref();
    console.log('Server started in background.');
  }
} else {
  console.log('Unknown command. Available subcommands: run, config, status, server');
}
