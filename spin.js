// LLMParty Agent Spinner CLI
// Usage: node spin.js --agent [coder|researcher|tester] --mode [local|gemini] --task "Your instructions here"

const fs = require('fs');
const path = require('path');

// Emojis for agent identities
const agentEmojis = {
  coder: '💻 CoderAgent',
  researcher: '🔍 ResearchAgent',
  tester: '🧪 TestAgent',
};

// System Prompts for different agent roles
const systemPrompts = {
  coder: `You are an expert software engineer. Provide clean, well-structured, production-ready code blocks. Focus on efficiency, security, and document-first design.`,
  researcher: `You are a meticulous technical analyst. Analyze the user's topic, outline critical details, summarize potential bottlenecks, and provide clear reference links.`,
  tester: `You are a QA automation engineer. Write detailed unit test scripts, outline edge cases, design test matrices, and provide debug checklists.`,
};

// Simple argument parser
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    agent: 'coder',
    mode: 'local',
    task: '',
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) {
      params.agent = args[i + 1].toLowerCase();
      i++;
    } else if (args[i] === '--mode' && args[i + 1]) {
      params.mode = args[i + 1].toLowerCase();
      i++;
    } else if (args[i] === '--task' && args[i + 1]) {
      params.task = args[i + 1];
      i++;
    }
  }

  return params;
}

async function runLocalAgent(systemPrompt, task) {
  console.log(`📡 Connecting to local LM Studio server (http://localhost:1234/v1)...`);
  try {
    const response = await fetch('http://localhost:1234/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5-7b-instruct-mlx', // default loaded local model
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: task }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`LM Studio HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (e) {
    throw new Error(`Failed connecting to LM Studio. Make sure 'lms server start' is running! Error: ${e.message}`);
  }
}

async function runGeminiAgent(systemPrompt, task) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing. Export your key first: export GEMINI_API_KEY="your-key"');
  }

  console.log(`🌐 Connecting to Google Gemini Cloud API (gemini-2.0-flash)...`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: task }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    if (data.candidates && data.candidates[0].content.parts[0].text) {
      return data.candidates[0].content.parts[0].text;
    } else {
      throw new Error('Unexpected response format from Gemini API');
    }
  } catch (e) {
    throw new Error(`Gemini API connection failed: ${e.message}`);
  }
}

async function main() {
  const config = parseArgs();

  if (!config.task) {
    console.log(`Usage: node spin.js --agent [coder|researcher|tester] --mode [local|gemini] --task "Your task details"`);
    process.exit(1);
  }

  const sysPrompt = systemPrompts[config.agent] || systemPrompts.coder;
  const agentLabel = agentEmojis[config.agent] || '🤖 Agent';

  console.log(`🚀 Spinning up ${agentLabel} in ${config.mode.toUpperCase()} mode...`);

  try {
    let result = '';
    if (config.mode === 'gemini') {
      result = await runGeminiAgent(sysPrompt, config.task);
    } else {
      result = await runLocalAgent(sysPrompt, config.task);
    }

    console.log(`\n=================== ${agentLabel} Response ===================\n`);
    console.log(result);
    console.log(`\n=============================================================\n`);

  } catch (e) {
    console.error(`❌ Agent error: ${e.message}`);
    process.exit(1);
  }
}

main();
