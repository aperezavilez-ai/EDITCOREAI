"use strict";

/**
 * STT local en Windows via System.Speech (DictationGrammar).
 * start() espera READY/ERR — no marca ok solo por lanzar PowerShell.
 */

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const PS_SCRIPT = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$cultures = @('es-ES','es-MX','es-US','en-US')
$engine = $null
foreach ($c in $cultures) {
  try {
    $ci = [System.Globalization.CultureInfo]::GetCultureInfo($c)
    $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine $ci
    break
  } catch {}
}
if (-not $engine) {
  try { $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine } catch {
    [Console]::Out.WriteLine('ERR:No SpeechRecognitionEngine')
    exit 1
  }
}
try {
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.SetInputToDefaultAudioDevice()
  $engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(45)
  $engine.BabbleTimeout = [TimeSpan]::FromSeconds(15)
  $engine.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(1200)
  $engine.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(900)
} catch {
  $msg = [string]$_.Exception.Message
  if ($msg -match 'reconocedor|recognizer|PlatformNotSupported|InstalledRecognizers') {
    [Console]::Out.WriteLine('ERR:Windows sin reconocimiento de voz instalado (Configuracion > Hora e idioma > Voz).')
  } else {
    [Console]::Out.WriteLine('ERR:' + $msg)
  }
  exit 1
}
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  try {
    $pause = Join-Path $env:TEMP 'editcore-stt-pause.flag'
    if (Test-Path $pause) {
      Start-Sleep -Milliseconds 250
      continue
    }
    $result = $engine.Recognize([TimeSpan]::FromSeconds(20))
    if ($null -ne $result -and $result.Text -and $result.Text.Trim().Length -gt 0) {
      [Console]::Out.WriteLine('STT:' + $result.Text.Trim())
      [Console]::Out.Flush()
    }
  } catch {
    Start-Sleep -Milliseconds 300
  }
}
`;

let activeProc = null;
const pauseFlagPath = path.join(os.tmpdir(), "editcore-stt-pause.flag");

function isSupported() {
  return process.platform === "win32";
}

function setPaused(paused) {
  try {
    if (paused) fs.writeFileSync(pauseFlagPath, "1", "utf8");
    else if (fs.existsSync(pauseFlagPath)) fs.unlinkSync(pauseFlagPath);
  } catch (_) {}
}

function stop() {
  setPaused(false);
  const proc = activeProc;
  activeProc = null;
  if (!proc) return { ok: true, stopped: false };
  try {
    if (!proc.killed) proc.kill();
  } catch (_) {}
  return { ok: true, stopped: true };
}

function isCliXmlNoise(text) {
  const value = String(text || "");
  return (
    value.includes("#< CLIXML")
    || value.includes("<Objs ")
    || value.includes("powershell/2004")
    || value.includes("PSCustomObject")
    || value.includes("SourceId")
  );
}

function cleanError(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value || isCliXmlNoise(value)) {
    return "Windows sin reconocimiento de voz instalado";
  }
  return value.slice(0, 160);
}

/**
 * @returns {Promise<{ok:boolean, pid?:number, error?:string}>}
 */
function start(onText, onStatus, { readyTimeoutMs = 8000 } = {}) {
  if (!isSupported()) {
    return Promise.resolve({ ok: false, error: "Windows STT solo en win32" });
  }
  stop();
  setPaused(false);

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (typeof onStatus === "function") {
        try {
          onStatus(result.ok ? { ready: true } : { ready: false, error: result.error });
        } catch (_) {}
      }
      resolve(result);
    };

    const encoded = Buffer.from(PS_SCRIPT, "utf16le").toString("base64");
    const proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    activeProc = proc;

    timer = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      finish({
        ok: false,
        error: "Windows STT no respondió a tiempo (¿reconocedor instalado?)",
      });
    }, readyTimeoutMs);

    let buffer = "";
    const handleLine = (line) => {
      const text = String(line || "").trim();
      if (!text || isCliXmlNoise(text)) return;
      if (text === "READY") {
        finish({ ok: true, pid: proc.pid });
        return;
      }
      if (text.startsWith("ERR:")) {
        try { proc.kill(); } catch (_) {}
        finish({ ok: false, error: cleanError(text.slice(4)) });
        return;
      }
      if (text.startsWith("STT:")) {
        const spoken = text.slice(4).trim();
        if (spoken && typeof onText === "function") onText(spoken);
      }
    };

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || "";
      for (const line of parts) handleLine(line);
    });
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk) => {
      const msg = String(chunk || "");
      if (isCliXmlNoise(msg)) return;
      if (/reconocedor|recognizer|PlatformNotSupported/i.test(msg) && !settled) {
        try { proc.kill(); } catch (_) {}
        finish({ ok: false, error: cleanError(msg) });
      }
    });
    proc.on("exit", (code) => {
      if (activeProc === proc) activeProc = null;
      if (!settled) {
        finish({
          ok: false,
          error: "Windows sin reconocimiento de voz instalado",
        });
      } else if (typeof onStatus === "function") {
        try { onStatus({ ready: false, exited: true, code }); } catch (_) {}
      }
    });
  });
}

function isRunning() {
  return Boolean(activeProc && !activeProc.killed);
}

module.exports = {
  isSupported,
  start,
  stop,
  setPaused,
  isRunning,
  pauseFlagPath,
  isCliXmlNoise,
  cleanError,
};
