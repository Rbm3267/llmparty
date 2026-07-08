// LLMParty Gemini Direct CLI
// Usage: node gemini.js "Your query here" [--system "Optional System Prompt"]

const fs = require('fs');

async function callGemini(systemPrompt, task) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ Error: GEMINI_API_KEY environment variable is missing.');
    console.error('Export it using: export GEMINI_API_KEY="your_api_key"');
    process.exit(1);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [{ parts: [{ text: task }] }]
  };

  if (systemPrompt) {
    payload.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Gemini API HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    if (data.candidates && data.candidates[0].content.parts[0].text) {
      return data.candidates[0].content.parts[0].text;
    } else {
      throw new Error('Could not parse response text.');
    }
  } catch (e) {
    throw new Error(`Gemini connection error: ${e.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let systemPrompt = '';
  let task = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--system' && args[i + 1]) {
      systemPrompt = args[i + 1];
      i++;
    } else {
      task = args[i];
    }
  }

  if (!task) {
    console.log('Usage: node gemini.js "Your prompt here" [--system "System instructions"]');
    process.exit(0);
  }

  try {
    console.log(`🤖 Consulting Gemini 2.0 Flash...`);
    const output = await callGemini(systemPrompt, task);
    console.log('\n--- Gemini Response ---');
    console.log(output);
    console.log('-----------------------\n');
  } catch (e) {
    console.error(`❌ Error: ${e.message}`);
    process.exit(1);
  }
}

main();
