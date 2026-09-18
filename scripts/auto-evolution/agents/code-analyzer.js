const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

function scanFile(filePath, patterns) {
  const fullPath = path.join(PROJECT_ROOT, filePath);
  if (!fs.existsSync(fullPath)) return { file: filePath, error: 'Not found' };
  const content = fs.readFileSync(fullPath, 'utf8');
  const findings = patterns.map(p => ({
    pattern: p.name,
    matches: (content.match(p.regex) || []).length
  })).filter(f => f.matches > 0);
  return { file: filePath, findings };
}

function run(input) {
  const report = {
    cycle: input.cycle,
    timestamp: new Date().toISOString(),
    scans: []
  };

  // Scan for IPC mismatches
  report.scans.push(scanFile('preload.js', [
    { name: 'contextBridge_expose', regex: /contextBridge\.exposeInMainWorld/g }
  ]));

  report.scans.push(scanFile('renderer.js', [
    { name: 'window_EditCore_usage', regex: /window\.EditCore[A-Za-z]+/g }
  ]));

  // Scan for timeout rigidity
  report.scans.push(scanFile('runtime/ai-core.js', [
    { name: 'provider_timeouts', regex: /timeout:\s*\d{1,6}000/g }
  ]));

  return { agent: 'CodeAnalyzer', status: 'SUCCESS', report };
}

module.exports = { run };
