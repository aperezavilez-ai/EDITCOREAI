const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, 'evolution-state.json');
const AGENTS_DIR = path.join(__dirname, 'agents');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { cycle: 0, gaps_identified: [], tools_created: [], status: 'INITIALIZED' };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function runAgent(agentName, input) {
  const agentPath = path.join(AGENTS_DIR, `${agentName}.js`);
  if (!fs.existsSync(agentPath)) {
    return { agent: agentName, error: 'Agent not found', output: null };
  }
  try {
    const agent = require(agentPath);
    return agent.run ? agent.run(input) : { agent: agentName, error: 'No run method', output: null };
  } catch (e) {
    return { agent: agentName, error: e.message, output: null };
  }
}

function orchestrateCycle() {
  const state = loadState();
  state.cycle += 1;
  state.timestamp = new Date().toISOString();

  const analysis = runAgent('code-analyzer', { cycle: state.cycle });
  const architecture = runAgent('architect', { analysis, gaps: state.gaps_identified });

  state.last_cycle = {
    cycle: state.cycle,
    analysis,
    architecture,
    timestamp: state.timestamp
  };

  saveState(state);
  return state;
}

module.exports = { orchestrateCycle, loadState, saveState };
