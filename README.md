# 🎉 LLMParty

**LLMParty** is a resilient, intelligent AI gateway and terminal multiplexer. It allows you to seamlessly route prompts across primary cloud providers (like Claude via the Claude CLI) and automatically fail over to local backups (like LM Studio or Ollama) with zero downtime if you hit rate limits, spend caps, or auth errors.

> 🌐 **Interactive Overview**: Open `overview.html` in your browser for a visual overview of the project's features and UI!

## ✨ Key Features

- 🚀 **Resilient Failover**: Instantly fails over from primary cloud models to secondary/local models mid-session without dropping your prompt.
- 💻 **Beautiful TUI**: A sophisticated, Claude Code style terminal UI featuring persistent status bars, dynamic model tracking, and typeahead suggestions.
- 🔌 **MCP Integration**: Fully compatible with Model Context Protocol (MCP) agents, allowing you to connect plugins seamlessly.
- 📊 **Smart Telemetry**: Tracks token usage, session costs, and provider health states. It knows when a provider has hit a monthly spend limit and automatically skips it until the next day!
- 🖥️ **Electron Dashboard**: A rich GUI dashboard for managing configurations, tracking historical metrics, and orchestrating models (built with React/MUI/Vite).

---

## 📦 Installation

### Prerequisites
- [Node.js](https://nodejs.org/en/) (v18 or higher recommended)
- `npm` or `yarn`
- (Optional but recommended) [Claude Code CLI](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)
- (Optional but recommended) [LM Studio](https://lmstudio.ai/) for running local fallback models

### 1. Clone & Install
```bash
git clone https://github.com/rbm3267/llmparty.git
cd llmparty
npm install
```

### 2. Link the CLI globally
To use the `llmparty` command from anywhere in your terminal:
```bash
npm link
# or
npm install -g .
```

---

## 🛠️ Usage

LLMParty consists of two main components: the **Gateway Server** and the **CLI/TUI**.

### Starting the Gateway Server
Before running the CLI, you need to start the background telemetry and routing proxy.
```bash
npm run server
# (or just `node server.js &`)
```
This starts the proxy on `http://localhost:9990/v1` which handles all the intelligent failover and token counting.

### Starting the CLI
To launch the beautiful Claude Code style terminal interface:
```bash
llmparty run
```
You'll be dropped into an interactive terminal where you can chat seamlessly. If your primary provider fails (e.g., you hit a rate limit on the Claude CLI), the CLI will instantly failover to your configured fallback model and notify you dynamically in the status bar!

### CLI Commands (Inside the TUI)
While inside the `llmparty run` session, you can use slash commands:
- `/status` — Check rates, failover diagnostics, and degraded providers.
- `/config view` — Display your active settings profile.
- `/config set primary <provider>` — Switch your primary model provider.
- `/agents list` — List your active MCP and LLM agents.
- `/clear` — Clear the chat history context.
- `/exit` — Exit the LLMParty session.

### Managing Configurations from Terminal
You can quickly check or edit your configurations without entering the chat:
```bash
llmparty config
llmparty config set anthropic.api_key "sk-ant-..."
llmparty config set backends.primary "claude_cli"
```

### Launching the Dashboard (Electron App)
LLMParty comes with a full graphical dashboard.
```bash
# Start the Vite dev server and Electron app
npm run dev
```

---

## ⚙️ How Failover Works

When the gateway attempts to contact your primary provider (e.g., `claude_cli`), it monitors the standard error streams for rate limits or org spend caps. 

If it detects an error like `"monthly spend limit"`, it:
1. Instantly routes the pending prompt to the configured `local_provider` (e.g., LM Studio).
2. Sets a `DEGRADED` state for the primary provider with a specific TTL (e.g., clears at midnight).
3. Warns you visually in the CLI that it skipped the provider.

This completely eliminates the friction of manually switching API keys or opening new tabs when you hit your daily usage caps!

---

## 📄 License
Private - Do Not Distribute without permission.
