const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\x1b[1m❯\x1b[0m '
});

const originalRefresh = rl._refreshLine.bind(rl);
rl._refreshLine = function() {
  originalRefresh();
  
  const line1 = '🔵 gemini-2.5-flash';
  const line2 = '⬢ JARVIS v11.7.5';
  const line3 = '← for agents';
  
  // Save cursor position
  process.stdout.write('\x1b[s');
  
  // Print status bar
  process.stdout.write(`\n\x1b[2K\r${line1}\n\x1b[2K\r${line2}\n\x1b[2K\r${line3}`);
  
  // Restore cursor position
  process.stdout.write('\x1b[u');
};

rl.prompt();
