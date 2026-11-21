/**
 * EditCore AI - Nexus Local Model Sidecar Manager
 * Controla el ciclo de vida automático e invisible de EditCore Nexus (1.5B).
 * - Se inicia silenciosamente cuando EditCoreAI se abre.
 * - Se cierra automáticamente cuando EditCoreAI se cierra (cero procesos huérfanos).
 * - Cero archivos .bat requeridos.
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

let nexusProcess = null;
let starting = false;

const NEXUS_ROOT = path.resolve('D:', 'PROGRAMAS IA', 'EDITCORE-MODEL');
const PYTHON_PATH = path.join(NEXUS_ROOT, '.venv', 'Scripts', 'python.exe');
const SCRIPT_PATH = path.join(NEXUS_ROOT, 'inference', 'serve_nexus_1_5b.py');
const FALLBACK_SCRIPT_PATH = path.join(NEXUS_ROOT, 'inference', 'serve.py');
const PORT = 11435;

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: '/', timeout: 1500 },
      (res) => resolve(res.statusCode === 200)
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startNexus() {
  if (nexusProcess && !nexusProcess.killed) return true;
  if (starting) return false;

  const alreadyUp = await checkHealth();
  if (alreadyUp) return true;

  const LLAMA_SERVER = path.join(NEXUS_ROOT, 'bin', 'llama-server.exe');
  const MODEL_7B = path.join(NEXUS_ROOT, 'models', 'qwen2.5-coder-7b-instruct-q4_k_m.gguf');

  if (fs.existsSync(LLAMA_SERVER) && fs.existsSync(MODEL_7B)) {
    console.log('[EditCore Nexus] Iniciando motor 7B nativo en GPU (puerto 11435)...');
    nexusProcess = spawn(LLAMA_SERVER, [
      '-m', MODEL_7B,
      '--port', String(PORT),
      '-ngl', '33',
      '-c', '4096',
      '--alias', 'editcore-nexus-v4',
      '--alias', 'editcore-nexus',
      '--host', '0.0.0.0'
    ], {
      cwd: NEXUS_ROOT,
      windowsHide: true,
      stdio: 'ignore'
    });

    nexusProcess.on('exit', () => {
      nexusProcess = null;
      starting = false;
    });

    return true;
  }

  if (!fs.existsSync(PYTHON_PATH)) {
    console.warn('[EditCore Nexus] Python local no encontrado en:', PYTHON_PATH);
    return false;
  }

  const scriptToRun = fs.existsSync(SCRIPT_PATH) ? SCRIPT_PATH : FALLBACK_SCRIPT_PATH;
  if (!fs.existsSync(scriptToRun)) {
    console.warn('[EditCore Nexus] Script de inferencia no encontrado.');
    return false;
  }

  starting = true;
  try {
    console.log('[EditCore Nexus] Iniciando modelo en segundo plano (puerto 11435)...');
    nexusProcess = spawn(PYTHON_PATH, [scriptToRun, '--port', String(PORT)], {
      cwd: NEXUS_ROOT,
      windowsHide: true,
      stdio: 'ignore'
    });

    nexusProcess.on('exit', () => {
      nexusProcess = null;
      starting = false;
    });

    return true;
  } catch (err) {
    console.error('[EditCore Nexus] Error al arrancar modelo:', err);
    starting = false;
    return false;
  }
}

function stopNexus() {
  if (nexusProcess && nexusProcess.pid) {
    const pid = nexusProcess.pid;
    console.log(`[EditCore Nexus] Cerrando servidor local PID ${pid}...`);
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
      } else {
        nexusProcess.kill('SIGKILL');
      }
    } catch {
      // Proceso posiblemente ya terminado
    }
    nexusProcess = null;
    starting = false;
  }
}

module.exports = {
  startNexus,
  stopNexus,
  checkHealth
};
