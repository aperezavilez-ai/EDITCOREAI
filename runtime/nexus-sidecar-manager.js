/**
 * EditCore AI - Nexus Sidecar Manager
 * Controla el ciclo de vida automático e invisible de EditCore Nexus v5.
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

const NEXUS_ROOT = path.join('D:\\', 'PROGRAMAS IA', 'EDITCORE-MODEL');
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
  const MODEL_32B = process.env.NEXUS_MODEL_32B || path.join(NEXUS_ROOT, 'models', 'qwen2.5-coder-32b-instruct-q4_k_m.gguf');
  const MODEL_14B = path.join(NEXUS_ROOT, 'models', 'qwen2.5-coder-14b-instruct-q4_k_m.gguf');
  const MODEL_7B = path.join(NEXUS_ROOT, 'models', 'qwen2.5-coder-7b-instruct-q4_k_m.gguf');

  const tier = (process.env.NEXUS_MODEL_TIER || (fs.existsSync(MODEL_32B) ? '32B' : (fs.existsSync(MODEL_14B) ? '14B' : '7B'))).toUpperCase();
  const want32B = tier === '32B' && fs.existsSync(MODEL_32B);
  const want14B = tier === '14B' && fs.existsSync(MODEL_14B);
  const modelToRun = want32B ? MODEL_32B : (want14B ? MODEL_14B : (fs.existsSync(MODEL_7B) ? MODEL_7B : (fs.existsSync(MODEL_14B) ? MODEL_14B : null)));
  const is32B = modelToRun === MODEL_32B;
  const is14B = modelToRun === MODEL_14B;

  if (fs.existsSync(LLAMA_SERVER) && modelToRun) {
    // Configuración optimizada de alta capacidad para GTX 1060 (6 GB VRAM Pascal):
    // 32B: 8 capas en VRAM, streaming NVMe C/mmap continuo sin OOM
    // 14B: 18 capas en VRAM (CUDA), KV Cache acelerado, hilos CPU físicos
    // 7B: 20 capas en VRAM
    const ngl = is32B ? '8' : (is14B ? '18' : '20');
    const threads = is32B ? '6' : (is14B ? '6' : '4');
    const batch = is32B ? '256' : (is14B ? '512' : '512');
    const loraAdapter = path.join(NEXUS_ROOT, 'checkpoints', 'nexus_14b_lora', 'adapter.gguf');
    const extraArgs = (is14B && fs.existsSync(loraAdapter)) ? ['--lora', loraAdapter] : [];
    if (is32B) {
      extraArgs.push('--ctk', 'q8_0', '--ctv', 'q8_0');
    }
    const modeDesc = is32B ? '32B (Modo Master Streaming NVMe)' : (is14B ? '14B (Modo Deep High-Capacity)' : '7B (Modo Fast)');
    console.log(`[EditCore Nexus V5] Iniciando motor principal ${modeDesc} (puerto ${PORT}, -ngl ${ngl}, threads ${threads}, --mmap)...`);
    nexusProcess = spawn(LLAMA_SERVER, [
      '-m', modelToRun,
      '--port', String(PORT),
      '-ngl', ngl,
      '-c', '8192',
      '-b', batch,
      '-ub', batch,
      '-np', '1',
      '--jinja',
      '--mmap',
      '--flash-attn',
      '--ctk', 'q8_0',
      '--ctv', 'q8_0',
      '--cont-batching',
      '--threads', threads,
      '--alias', 'editcore-nexus-v5,editcore-nexus-v4,editcore-nexus',
      '--host', '127.0.0.1',
      ...extraArgs
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

let mediaProcess = null;
const MEDIA_PORT = 11436;

function checkMediaHealth() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: MEDIA_PORT, path: '/health', timeout: 1500 },
      (res) => resolve(res.statusCode === 200)
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startMediaStudio() {
  if (mediaProcess && !mediaProcess.killed) return true;
  const alreadyUp = await checkMediaHealth();
  if (alreadyUp) return true;

  const MEDIA_SCRIPT = path.join(NEXUS_ROOT, 'inference', 'media_server.py');
  if (fs.existsSync(MEDIA_SCRIPT)) {
    try {
      mediaProcess = spawn('py', ['-3.12', MEDIA_SCRIPT, '--port', String(MEDIA_PORT)], {
        cwd: NEXUS_ROOT,
        windowsHide: true,
        stdio: 'ignore'
      });
      mediaProcess.on('exit', () => { mediaProcess = null; });
      return true;
    } catch {
      return false;
    }
  }
  return false;
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
  if (mediaProcess && mediaProcess.pid) {
    try {
      execSync(`taskkill /F /T /PID ${mediaProcess.pid}`, { stdio: 'ignore' });
    } catch {}
    mediaProcess = null;
  }
}

module.exports = {
  startNexus,
  stopNexus,
  checkHealth,
  startMediaStudio,
  checkMediaHealth
};
