# LLMParty Coding Conventions for Aider

Aider should conform to the following code rules during development:

1. **Stack Details:**
   - Framework: Electron (Main process) + React + Vite (Renderer).
   - Styling: Vanilla CSS exclusively. Custom styling tokens belong in `src/index.css`.
   - IPC Mechanism: Communication between React and Electron must run via `preload.js` bridge. No direct `require` imports in the renderer.

2. **Commit Policy:**
   - Write clear, present-tense Git commit messages.
   - Run a quick build verification (`npm run build`) before compiling commits.

3. **Behavioral Constraints:**
   - Since Aider executes edits directly, prioritize keeping existing comments and file structure intact.
   - If files are edited, do not introduce dummy placeholders or incomplete comments (e.g. `// ... code here`). Write complete, drop-in replacements.
