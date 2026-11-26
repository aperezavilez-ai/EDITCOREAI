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

// [CORRECCIÓN 3] La casa del modelo propio: la carpeta se llamaba
// EDITCORE-MODEL y pasa a llamarse EDITCORE NEXUS V5. Se aceptan
// ambos nombres (el que exista en disco manda) para que el
// renombrado sea seguro en cualquier orden.
function resolverRaizNexus() {
  const candidatas = [
    path.join('D:\\', 'PROGRAMAS IA', 'EDITCORE NEXUS V5'),
    path.join('D:\\', 'PROGRAMAS IA', 'EDITCORE-MODEL'),
  ];
  for (const c of candidatas) {
    try { if (fs.existsSync(c)) return c; } catch { /* seguir */ }
  }
  return candidatas[0];
}
const NEXUS_ROOT = resolverRaizNexus();
const PYTHON_PATH = path.join(NEXUS_ROOT, '.venv', 'Scripts', 'python.exe');
const SERVE_SCRIPT = path.join(NEXUS_ROOT, 'inference', 'serve.py');
// [CORRECCIÓN 3 + MINI-V5] El modelo propio que Nexus sirve: el
// checkpoint v5 (dialecto de herramientas de EditCoreAI, juzgado
// en vivo por HTTP el 2026-11-25), no el que serve.py traiga
// por defecto.
const CHECKPOINT_PROPIO = path.join('checkpoints', 'base-sft-v6', 'epoch-3');
const PORT = 11435;

// [CORRECCIÓN 3] Arranque ÚNICO de Nexus: el modelo propio con
// serve.py y su checkpoint v5. Fuera la rama de llama.cpp con
// GGUF de terceros (Qwen): Nexus es independiente y solo sirve
// sus propios pesos. Devuelve null si falta el intérprete o el
// servidor: nada que prometer cuando el modelo no está.
function resolverArranqueNexus(rootOverride) {
  const root = rootOverride || NEXUS_ROOT;
  const python = path.join(root, '.venv', 'Scripts', 'python.exe');
  const script = path.join(root, 'inference', 'serve.py');
  if (!fs.existsSync(python) || !fs.existsSync(script)) return null;
  return {
    tipo: 'python',
    python,
    script,
    args: ['--ckpt', CHECKPOINT_PROPIO, '--port', String(PORT)],
    cwd: root,
  };
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: '/health', timeout: 1500 },
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

  const arranque = resolverArranqueNexus();
  if (!arranque) {
    console.warn('[EditCore Nexus] Modelo propio no encontrado (python o serve.py) en:', NEXUS_ROOT);
    return false;
  }

  starting = true;
  try {
    console.log(`[EditCore Nexus] Iniciando modelo propio «editcore-nexus» (${CHECKPOINT_PROPIO}, puerto ${PORT})...`);
    nexusProcess = spawn(arranque.python, [arranque.script, ...arranque.args], {
      cwd: arranque.cwd,
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
  resolverArranqueNexus,
  stopNexus,
  checkHealth,
  startMediaStudio,
  checkMediaHealth
};
