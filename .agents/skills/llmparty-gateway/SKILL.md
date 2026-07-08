---
name: llmparty-gateway
description: >
  Architecture cheatsheet and debugging guide for the LLMParty AI gateway project
  at /Users/bennett.moore/Documents/GitHubRepos/LLMParty. Covers provider routing,
  correct API endpoints, build/restart cycle, frontend serving, and quick test commands.
  Activate when working on or debugging LLMParty.
---

# LLMParty Gateway — Architecture & Cheatsheet

## Project Layout

```
LLMParty/
├── server.js          # Node HTTP gateway + API backend (port 9990)
├── cli.js             # CLI entry point (llmparty command)
├── src/               # React frontend (Vite)
│   ├── App.jsx        # Shell: sidebar nav, topbar, state management
│   ├── App.css        # Custom design system (no MUI layout)
│   ├── index.css      # Design tokens (CSS vars), fonts, animations
│   └── components/
│       ├── Dashboard.jsx       # KPI cards, charts, request log
│       ├── Configuration.jsx   # API keys, pipeline config
│       ├── Models.jsx          # Model registry + browser
│       ├── Logs.jsx            # Syntax-colored log viewer
│       └── Settings.jsx        # System info, gateway docs
├── dist/              # Vite build output (server.js serves from here)
├── dist-app/          # Legacy build fallback
└── ~/.llmparty/
    ├── config.json    # Runtime config (API keys, models, pipeline)
    └── server.log     # Server stdout/stderr
```

## Config File

Located at `~/.llmparty/config.json`:

```json
{
  "tui": { "theme": "party", "rainbow_speed": 1 },
  "backends": {
    "primary": "anthropic",
    "local_provider": "lmstudio",
    "pipeline": ["anthropic", "gemini", "local"],
    "anthropic": { "api_key": "sk-ant-...", "model": "claude-sonnet-4-6" },
    "openai":    { "api_key": "sk-...",     "model": "gpt-4o" },
    "gemini":    { "api_key": "...",        "model": "gemini-2.5-flash" },
    "local":     { "base_url": "http://localhost:1234/v1", "model": "qwen2.5-7b-instruct-mlx" }
  }
}
```

## Provider Routing (server.js)

Model name → pipeline index detection (`detectProviderFromModel`):

| Model prefix         | Provider    |
|----------------------|-------------|
| `gemini-*`           | `gemini`    |
| `claude-*`           | `anthropic` |
| `gpt-*`, `o1-*`, `o3-*` | `openai` |
| `qwen-*`, `llama-*`, `mistral-*`, `deepseek-*`, `phi-*` | `local` |
| (unknown)            | pipeline[0] (primary) |

Requests start at the detected provider index, with automatic failover to subsequent pipeline entries on 429/401/5xx.

## API Endpoints (Correct URLs)

| Provider  | Endpoint |
|-----------|----------|
| Anthropic | `https://api.anthropic.com/v1/messages` |
| OpenAI    | `https://api.openai.com/v1/chat/completions` |
| **Gemini**| `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?key=KEY` |
| Local     | `{config.backends.local.base_url}/chat/completions` |

> ⚠️ Gemini requires the `/v1beta/openai/` path (not `/v1beta/`) for OpenAI-compatible format.
> ⚠️ Gemini model names must be prefixed: `"models/gemini-2.5-flash"` in the request body.
> ⚠️ Anthropic requires `x-api-key` header (not `Authorization: Bearer`), `anthropic-version: 2023-06-01`, and `max_tokens` in the body.

## Build + Restart Cycle

```bash
# Full rebuild and restart
npm run build && pkill -f "node server.js" && node server.js > ~/.llmparty/server.log 2>&1 &

# Check server started
lsof -i :9990 | grep LISTEN

# Watch logs live
tail -f ~/.llmparty/server.log
```

## Frontend Serving (server.js)

The server serves static files with this priority:
1. `dist/` — Vite default output (`npm run build`)
2. `dist-app/` — legacy fallback
3. All non-asset paths → `index.html` (SPA fallback for React router)

Always run `npm run build` after editing any file in `src/`. The server reads from the compiled `dist/` bundle.

## Quick Test Commands

```bash
# Test Gemini routing
curl -s http://localhost:9990/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"Hi"}]}' \
  | jq '.choices[0].message.content'

# Test Anthropic routing
curl -s http://localhost:9990/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"Hi"}]}' \
  | jq '.choices[0].message.content'

# Check proxy logs
curl -s http://localhost:9990/api/proxy-logs | jq '.[0]'

# Check config
curl -s http://localhost:9990/api/configs | jq '.backends.primary'
```

## UI Design System

The frontend uses a **custom CSS design system** (no MUI layout, only MUI for `Snackbar`/`Alert`/`CircularProgress`):

- **Design tokens**: CSS variables in `index.css` — `--bg-base`, `--accent-amber`, `--accent-emerald`, etc.
- **Layout**: Fixed left sidebar (220px) + topbar (52px) + scrollable `page-body`
- **Accent color**: Amber (`#f59e0b`) as primary, emerald for success, rose for errors
- **Typography**: Inter (UI) + JetBrains Mono (data/code)
- **Component classes**: `.card`, `.btn`, `.field-input`, `.data-table`, `.tag`, `.provider-badge`
- **Provider badge classes**: `.pb-anthropic`, `.pb-openai`, `.pb-gemini`, `.pb-local`

When adding new pages or components, use these CSS classes rather than inline MUI `sx` props.

## Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Blank page | JS crash before React mount | Check browser console for `ReferenceError`/`TypeError` |
| Wrong provider used | Model not in routing table | Add prefix to `detectProviderFromModel()` in server.js |
| Gemini 404 | Wrong endpoint path | Use `/v1beta/openai/chat/completions` not `/v1beta/chat/completions` |
| Old UI still showing | Stale browser cache | Hard refresh `Cmd+Shift+R` |
| `EADDRINUSE :9990` | Old server process still running | `pkill -f "node server.js"` |
