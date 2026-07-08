// LLMParty Multi-Agent Orchestrator
// Usage: node multi-agent.js --task "Your complex developer request" [--mode local|gemini]

const fs = require('fs');

// System prompts for our team of agents
const systemPrompts = {
  planner: `You are the Coordinator Agent. Break down the user's software task into a strict JSON plan with keys: 'code_plan' (what code files to create and their scope) and 'test_plan' (what test files to create). Keep response as pure JSON.`,
  coder: `You are the Developer Agent. Implement the code files outlined in the Plan. Output ONLY the complete, production-ready code inside standard markdown blocks.`,
  tester: `You are the QA Tester Agent. Take the Code output and write complete unit tests. Output ONLY the test code inside standard markdown blocks.`,
  reviewer: `You are the Code Reviewer Agent. Review the Coder's implementation and the Tester's unit tests. Verify logic alignment and syntax correctness. Output a final evaluation score out of 10 and detail any bugs found.`
};

async function callLLM(mode, systemPrompt, task) {
  if (mode === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY env variable missing.');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: task }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
      })
    });
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  } else {
    // Local LM Studio Qwen model
    const response = await fetch('http://localhost:1234/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5-7b-instruct-mlx',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: task }
        ],
        temperature: 0.2
      })
    });
    const data = await response.json();
    return data.choices[0].message.content;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let task = '';
  let mode = 'local';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task' && args[i + 1]) {
      task = args[i + 1];
      i++;
    } else if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1].toLowerCase();
      i++;
    }
  }

  if (!task) {
    console.log('Usage: node multi-agent.js --task "Create a module and write tests" [--mode local|gemini]');
    process.exit(0);
  }

  console.log(`🤖 Starting Multi-Agent Orchestrator (Mode: ${mode.toUpperCase()})`);
  console.log(`User Objective: "${task}"\n`);

  try {
    // Step 1: Spin up Planner
    console.log('🗓️  [Step 1] Spinning up Planner Agent to architect task breakdown...');
    const planText = await callLLM(mode, systemPrompts.planner, task);
    console.log('--- Plan Generated ---');
    console.log(planText.trim());
    console.log('----------------------\n');

    // Step 2: Spin up Developer
    console.log('💻 [Step 2] Spinning up Developer Agent to write code implementations...');
    const codeOutput = await callLLM(mode, systemPrompts.coder, `Plan:\n${planText}\nObjective: ${task}`);
    console.log('--- Code Generated ---');
    console.log(codeOutput.trim());
    console.log('----------------------\n');

    // Step 3: Spin up Tester
    console.log('🧪 [Step 3] Spinning up Tester Agent to write unit test cases...');
    const testOutput = await callLLM(mode, systemPrompts.tester, `Source Code:\n${codeOutput}\nPlan details:\n${planText}`);
    console.log('--- Test Code Generated ---');
    console.log(testOutput.trim());
    console.log('---------------------------\n');

    // Step 4: Spin up Reviewer
    console.log('🔎 [Step 4] Spinning up Reviewer Agent to cross-evaluate quality...');
    const reviewOutput = await callLLM(mode, systemPrompts.reviewer, `Source Code:\n${codeOutput}\nTests:\n${testOutput}`);
    console.log('--- Final Review Score & Feedback ---');
    console.log(reviewOutput.trim());
    console.log('-------------------------------------\n');

    console.log('✅ Pipeline execution completed successfully!');

  } catch (e) {
    console.error(`❌ Pipeline crash: ${e.message}`);
    process.exit(1);
  }
}

main();
