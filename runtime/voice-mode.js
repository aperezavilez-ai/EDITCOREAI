"use strict";

/**
 * EDITCOREAI - Modo de Voz Manos Libres con Orbe Interactivo (Estilo ChatGPT Voice).
 * - Reconocimiento de voz continuo con doble motor (WebSpeech API + MediaRecorder AI STT Fallback).
 * - Cierre y envío automático al detectar palabras clave ("basta", "alto", "fin de consulta", "listo", "enviar", etc.) o al presionar 🎤/✕.
 * - Registro automático de la transcripción en el historial del chat como evidencia pública al finalizar.
 * - Saludo y síntesis de voz (TTS) en español con soporte de interrupción (Barge-in).
 * - Orbe reactivo en Canvas 300x300 solo en el centro del chat.
 */

(function exposeVoiceMode(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreVoiceMode = api;
})(typeof window !== "undefined" ? window : globalThis, function createVoiceMode() {
  let isActive = false;
  let isSpeaking = false;
  let isProcessing = false;
  let speechSynth = typeof window !== "undefined" && window.speechSynthesis ? window.speechSynthesis : null;
  let selectedVoice = null;
  let recognition = null;
  let mediaRecorder = null;
  let audioStream = null;
  let audioContext = null;
  let analyser = null;
  let meterAnimId = null;
  let currentMicVolume = 0;
  let liveTranscript = "";
  let silenceTimer = null;
  let optionsCallbacks = {};
  let callLog = [];
  let lastSpokenFingerprint = "";
  let activeRecorderChunks = [];
  let flushIntervalTimer = null;
  let lastTtsFingerprint = "";
  let lastSttFailure = "";
  let windowsSttUnsub = null;
  let windowsSttStatusUnsub = null;
  let windowsSttActive = false;
  let stopInFlight = null;

  const CLOSING_PHRASE_REGEX = /\b(basta|alto|fin\s+de\s+consulta|fin\s+de\s+llamada|finalizar|terminar|listo|enviar|env[ií]a|procede|parar|stop|adi[oó]s|colgar|apagar\s+voz|cerrar|salir)\b/i;

  function isClosingPhrase(text) {
    if (!text) return false;
    return CLOSING_PHRASE_REGEX.test(text.trim());
  }

  function cleanQueryText(text) {
    if (!text) return "";
    const clean = text.replace(CLOSING_PHRASE_REGEX, "").trim();
    return clean || text.trim();
  }

  function cleanTextForSpeech(text) {
    if (!text) return "";
    let clean = String(text);
    clean = clean.replace(/```[\s\S]*?```/g, " Bloque de código. ");
    clean = clean.replace(/`([^`]+)`/g, "$1");
    clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    clean = clean.replace(/https?:\/\/\S+/gi, "enlace web");
    clean = clean.replace(/^#+\s+/gm, "");
    clean = clean.replace(/[*_~#>]/g, "");
    clean = clean.replace(/\|[^\n]+\|/g, "");
    clean = clean.replace(/\n+/g, ". ");
    clean = clean.replace(/\s{2,}/g, " ").trim();
    return clean;
  }

  function pickBestSpanishVoice() {
    if (!speechSynth) return null;
    const voices = speechSynth.getVoices();
    if (!voices || !voices.length) return null;
    const preferredNames = ["Sabina", "Helena", "Laura", "Raul", "Pablo", "Monica", "Jorge", "Google español", "Microsoft"];
    for (const name of preferredNames) {
      const found = voices.find((v) => (v.lang.startsWith("es") || v.lang === "spa") && v.name.toLowerCase().includes(name.toLowerCase()));
      if (found) return found;
    }
    return voices.find((v) => v.lang.startsWith("es") || v.lang === "spa") || voices[0] || null;
  }

  function initVoices() {
    if (!speechSynth) return;
    selectedVoice = pickBestSpanishVoice();
    if (speechSynth.onvoiceschanged !== undefined) {
      speechSynth.onvoiceschanged = () => {
        selectedVoice = pickBestSpanishVoice();
      };
    }
  }

  function getDom() {
    return {
      overlay: document.getElementById("voiceOverlay"),
      canvas: document.getElementById("voiceOrbCanvas"),
      statusLabel: document.getElementById("voiceStatusLabel"),
      subtitle: document.getElementById("voiceSubtitle"),
      hangupBtn: document.getElementById("voiceHangupBtn"),
      voiceBtn: document.getElementById("voiceBtn"),
      prompt: document.getElementById("prompt"),
      form: document.getElementById("chatForm"),
    };
  }

  function updateStatus(text) {
    const dom = getDom();
    if (dom.statusLabel) dom.statusLabel.textContent = text;
    if (typeof optionsCallbacks.onStatus === "function") {
      try { optionsCallbacks.onStatus(text); } catch (_) {}
    }
  }

  function updateSubtitle(text) {
    const dom = getDom();
    if (dom.subtitle) dom.subtitle.textContent = text ? `"${text}"` : '"Escuchando tu voz..."';
  }

  function normalizeSpeechFp(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  function isEchoOfTts(text) {
    const fp = normalizeSpeechFp(text);
    if (!fp || !lastTtsFingerprint) return false;
    if (fp === lastTtsFingerprint) return true;
    if (fp.length >= 12 && lastTtsFingerprint.includes(fp)) return true;
    if (lastTtsFingerprint.length >= 12 && fp.includes(lastTtsFingerprint.slice(0, 48))) return true;
    // Eco parcial del saludo típico
    if (/hola\s+soy\s+editcore/.test(fp) && /hola\s+soy\s+editcore/.test(lastTtsFingerprint)) return true;
    return false;
  }

  async function setWindowsSttPaused(paused) {
    try {
      await window.editcoreApp?.windowsSttPause?.(Boolean(paused));
    } catch (_) {}
  }

  async function startWindowsSttListener() {
    if (typeof window === "undefined" || !window.editcoreApp?.windowsSttStart) {
      return { ok: false, error: "Windows STT bridge ausente" };
    }
    try {
      windowsSttUnsub?.();
      windowsSttStatusUnsub?.();
      windowsSttUnsub = window.editcoreApp.onWindowsSttText?.((text) => {
        if (!isActive || isSpeaking) return;
        handleSpokenText(text);
      }) || null;
      windowsSttStatusUnsub = window.editcoreApp.onWindowsSttStatus?.((status) => {
        if (!status) return;
        if (status.ready) {
          windowsSttActive = true;
          if (isActive && !isSpeaking && !isProcessing) {
            updateStatus("Escuchando (Windows STT)...");
          }
        } else if (status.error) {
          lastSttFailure = String(status.error);
          reportSttError(`Windows: ${status.error}`);
        }
      }) || null;
      const result = await window.editcoreApp.windowsSttStart();
      windowsSttActive = Boolean(result?.ok);
      return result || { ok: false, error: "Windows STT no inició" };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async function stopWindowsSttListener() {
    windowsSttActive = false;
    try { windowsSttUnsub?.(); } catch (_) {}
    try { windowsSttStatusUnsub?.(); } catch (_) {}
    windowsSttUnsub = null;
    windowsSttStatusUnsub = null;
    try { await window.editcoreApp?.windowsSttStop?.(); } catch (_) {}
    try { await setWindowsSttPaused(false); } catch (_) {}
  }

  function speak(text, onDone) {
    if (!speechSynth) {
      if (onDone) onDone();
      return;
    }
    try { speechSynth.cancel(); } catch (_) {}
    const clean = cleanTextForSpeech(text);
    if (!clean) {
      if (onDone) onDone();
      return;
    }

    lastTtsFingerprint = normalizeSpeechFp(clean);
    void setWindowsSttPaused(true);

    const utterance = new SpeechSynthesisUtterance(clean);
    if (!selectedVoice) selectedVoice = pickBestSpanishVoice();
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.lang = selectedVoice?.lang || "es-ES";
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    isSpeaking = true;
    if (window.EditCoreVoiceOrb) {
      window.EditCoreVoiceOrb.setState("speaking");
      window.EditCoreVoiceOrb.setVolume(0.7);
    }
    updateStatus("EDITCOREAI hablando...");

    let doneCalled = false;
    const finish = () => {
      if (doneCalled) return;
      doneCalled = true;
      isSpeaking = false;
      void setWindowsSttPaused(false);
      if (isActive && !isProcessing) {
        updateStatus(windowsSttActive ? "Escuchando (Windows STT)..." : "Escuchando tu voz...");
        if (window.EditCoreVoiceOrb) {
          window.EditCoreVoiceOrb.setState("listening");
          window.EditCoreVoiceOrb.setVolume(0.1);
        }
      }
      if (typeof onDone === "function") onDone();
    };

    utterance.onend = finish;
    utterance.onerror = finish;
    setTimeout(finish, Math.max(2500, Math.min(15000, clean.length * 70)));

    try {
      speechSynth.speak(utterance);
    } catch (_) {
      finish();
    }
  }

  function submitQueryAndDispatch(spokenText) {
    const raw = (spokenText || liveTranscript || "").trim();
    if (!raw) return;
    const cleaned = cleanQueryText(raw);
    if (!cleaned || isEchoOfTts(cleaned)) return;

    pushCallTurn("user", cleaned);
    isProcessing = true;
    updateStatus("EDITCOREAI pensando...");
    if (window.EditCoreVoiceOrb) {
      window.EditCoreVoiceOrb.setState("thinking");
      window.EditCoreVoiceOrb.setVolume(0.5);
    }

    const dom = getDom();
    if (dom.prompt) {
      dom.prompt.value = cleaned;
    }

    // Misma ruta que escribir en el chat: steer si hay agente en curso; si no, send/Agente.
    liveTranscript = "";
    if (typeof optionsCallbacks.onSteer === "function" && optionsCallbacks.onSteer(cleaned)) {
      return true;
    }
    if (typeof optionsCallbacks.onSend === "function") {
      optionsCallbacks.onSend(cleaned);
      return true;
    }
    if (dom.form) {
      dom.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      return true;
    }
    isProcessing = false;
    return false;
  }

  function handleSpokenText(text) {
    if (!text || !isActive || isProcessing) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (isEchoOfTts(trimmed)) return;

    const fp = normalizeSpeechFp(trimmed);
    if (fp && fp === lastSpokenFingerprint) return;

    // Si el usuario habla mientras el bot habla, interrumpe el habla del bot (Barge-in)
    if (isSpeaking) {
      if (speechSynth) try { speechSynth.cancel(); } catch (_) {}
      isSpeaking = false;
      void setWindowsSttPaused(false);
      if (window.EditCoreVoiceOrb) window.EditCoreVoiceOrb.setState("listening");
    }

    liveTranscript = trimmed;
    updateSubtitle(trimmed);

    if (isClosingPhrase(trimmed)) {
      lastSpokenFingerprint = fp;
      submitQueryAndDispatch(trimmed);
      return;
    }

    // Pausa (~1.8 s) tras hablar → enviar al agente igual que al pulsar Enviar
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (isActive && !isProcessing && liveTranscript) {
        lastSpokenFingerprint = normalizeSpeechFp(liveTranscript);
        submitQueryAndDispatch(liveTranscript);
      }
    }, 1800);
  }

  async function startMicMeter(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioContext = new AudioCtx();
      if (audioContext.state === "suspended") {
        await audioContext.resume().catch(() => {});
      }
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkVol = () => {
        if (!isActive) return;
        if (analyser) {
          try {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            currentMicVolume = Math.min(1, avg / 35);

            // Interrupción por voz activa (Barge-in)
            if (isSpeaking && currentMicVolume > 0.22) {
              if (speechSynth) try { speechSynth.cancel(); } catch (_) {}
              isSpeaking = false;
              if (window.EditCoreVoiceOrb) window.EditCoreVoiceOrb.setState("listening");
            }

            if (!isSpeaking && window.EditCoreVoiceOrb) {
              window.EditCoreVoiceOrb.setVolume(currentMicVolume);
            }
          } catch (_) {}
        }
        meterAnimId = requestAnimationFrame(checkVol);
      };
      meterAnimId = requestAnimationFrame(checkVol);
    } catch (e) {
      console.warn("[VoiceMode] Mic meter error:", e);
    }
  }

  function getTranscribeFn() {
    if (typeof window === "undefined") return null;
    // Bridge real de EDITCOREAI (preload). Compat: electronAPI legacy si existiera.
    const fn = window.editcoreApp?.transcribeAudio
      || window.electronAPI?.transcribeAudio
      || null;
    return typeof fn === "function" ? fn.bind(window.editcoreApp || window.electronAPI || window) : null;
  }

  function getSttStatusFn() {
    if (typeof window === "undefined") return null;
    const fn = window.editcoreApp?.sttStatus || null;
    return typeof fn === "function" ? fn.bind(window.editcoreApp) : null;
  }

  let lastSttErrorAt = 0;
  function cleanWindowsError(message) {
    const msg = String(message || "").replace(/\s+/g, " ").trim();
    if (!msg) return "";
    if (msg.includes("<Objs") || msg.includes("CLIXML") || msg.includes("PSCustom")) {
      return "Windows sin reconocimiento de voz instalado";
    }
    return msg.slice(0, 120);
  }
  function reportSttError(message) {
    const msg = cleanWindowsError(message) || String(message || "").trim();
    if (!msg) return;
    lastSttFailure = msg;
    const now = Date.now();
    if (now - lastSttErrorAt < 4000) return;
    lastSttErrorAt = now;
    console.warn("[VoiceMode] STT:", msg);
    updateStatus(`STT: ${msg.slice(0, 90)}`);
  }

  async function probeSttAvailability() {
    const statusFn = getSttStatusFn();
    if (!statusFn) {
      return { canTranscribe: Boolean(getTranscribeFn()), note: "Sin sonda STT" };
    }
    try {
      return await statusFn();
    } catch (err) {
      return { canTranscribe: false, note: String(err?.message || err) };
    }
  }

  function pushCallTurn(role, text) {
    const value = String(text || "").trim();
    if (!value) return;
    const last = callLog[callLog.length - 1];
    if (last && last.role === role && last.text === value) return;
    callLog.push({ role, text: value, at: Date.now() });
  }

  function formatCallTranscript() {
    if (!callLog.length) return "";
    const userTurns = callLog.filter((t) => t.role === "user").length;
    const lines = [
      "## Llamada de voz",
      "",
      `_Sesión finalizada · ${callLog.length} turno(s)_`,
      "",
    ];
    for (const turn of callLog) {
      const who = turn.role === "user" ? "Tú" : "EDITCOREAI";
      lines.push(`**${who}:** ${turn.text}`);
      lines.push("");
    }
    if (!userTurns) {
      lines.push("---");
      lines.push("");
      lines.push(
        `_No se captó voz del usuario._ ${
          lastSttFailure
            ? `Último error STT: ${lastSttFailure}`
            : "Si hablaste y no aparece aquí, el reconocedor no recibió audio (habla tras el saludo, ~2 s)."
        }`,
      );
    }
    return lines.join("\n").trim();
  }

  async function flushCurrentAudioChunks(finalFlush = false) {
    const transcribe = getTranscribeFn();
    if (!activeRecorderChunks.length || !transcribe) return;
    const chunksToProcess = activeRecorderChunks;
    activeRecorderChunks = [];

    try {
      const mime = mediaRecorder?.mimeType || "audio/webm";
      const blob = new Blob(chunksToProcess, { type: mime });
      if (blob.size < 500 && !finalFlush) return;

      const arrayBuffer = await blob.arrayBuffer();
      const result = await transcribe(arrayBuffer, mime);
      if (result && result.text && result.text.trim()) {
        handleSpokenText(result.text.trim());
      } else if (result?.ok === false && result?.error) {
        reportSttError(result.error);
      }
    } catch (err) {
      reportSttError(err?.message || String(err));
    }
  }

  function setupMediaRecorderFallback(stream) {
    try {
      if (!window.MediaRecorder || !getTranscribeFn()) {
        console.warn("[VoiceMode] MediaRecorder STT no disponible (editcoreApp.transcribeAudio ausente)");
        return;
      }
      activeRecorderChunks = [];

      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = mimeCandidates.find((m) => {
        try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
      }) || "";
      mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          activeRecorderChunks.push(e.data);
        }
      };

      mediaRecorder.start(500); // Record in 500ms chunks

      if (flushIntervalTimer) clearInterval(flushIntervalTimer);
      flushIntervalTimer = setInterval(() => {
        if (isActive && activeRecorderChunks.length > 0) {
          void flushCurrentAudioChunks(false);
        }
      }, 1500);
    } catch (e) {
      console.warn("[VoiceMode] MediaRecorder setup error:", e);
    }
  }

  function setupSpeechRecognition() {
    try {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) return null;
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "es-ES";
      rec.maxAlternatives = 1;

      rec.onresult = (event) => {
        if (!isActive || isProcessing) return;
        let interim = "";
        let finalStr = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          if (item.isFinal) {
            finalStr += item[0].transcript + " ";
          } else {
            interim += item[0].transcript;
          }
        }
        const text = (finalStr + interim).trim();
        if (text) {
          handleSpokenText(text);
        }
      };

      rec.onerror = (err) => {
        console.warn("[VoiceMode] SpeechRecognition error:", err);
      };

      rec.onend = () => {
        if (isActive && !isProcessing) {
          try { rec.start(); } catch (_) {}
        }
      };

      return rec;
    } catch (_) {
      return null;
    }
  }

  async function start(greeting = "Hola. Soy EDITCOREAI. Te escucho: dime qué necesitas para tu proyecto.") {
    if (isActive) return;
    isActive = true;
    isSpeaking = false;
    isProcessing = false;
    liveTranscript = "";
    currentMicVolume = 0;
    callLog = [];
    lastSpokenFingerprint = "";
    lastTtsFingerprint = "";
    lastSttFailure = "";
    windowsSttActive = false;

    const dom = getDom();
    if (dom.overlay) {
      dom.overlay.classList.remove("hidden");
    }
    if (dom.voiceBtn) {
      dom.voiceBtn.classList.add("active");
    }

    initVoices();
    pushCallTurn("assistant", greeting);

    // Inicializar el Orbe en el canvas de 300x300
    if (dom.canvas && window.EditCoreVoiceOrb) {
      try {
        window.EditCoreVoiceOrb.init(dom.canvas);
        window.EditCoreVoiceOrb.setState("speaking");
        window.EditCoreVoiceOrb.start();
      } catch (err) {
        console.warn("[VoiceMode] Orb start error:", err);
      }
    }

    const hasTranscribe = Boolean(getTranscribeFn());
    const sttInfo = await probeSttAvailability();
    // Con bridge IPC siempre grabamos para Whisper (meai/apicredits). Windows STT
    // solo si NO hay bridge — en esta PC el reconocedor no está instalado y ensucia el chat.
    const useCloudRecorder = hasTranscribe;
    let useWindows = false;
    if (!useCloudRecorder && sttInfo?.windowsDictation) {
      const winResult = await startWindowsSttListener();
      useWindows = Boolean(winResult?.ok);
      if (!useWindows) {
        reportSttError(winResult?.error || "Windows STT no disponible");
      } else {
        await setWindowsSttPaused(true);
      }
    } else {
      lastSttFailure = "";
    }

    try {
      if (!useWindows && navigator.mediaDevices?.getUserMedia) {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        startMicMeter(audioStream);
        if (useCloudRecorder) {
          setupMediaRecorderFallback(audioStream);
        }
      }
    } catch (e) {
      console.warn("[VoiceMode] Mic stream error:", e);
      if (!useWindows) updateStatus("Micrófono bloqueado o no disponible");
    }

    // Web Speech: bonus; en Electron suele fallar
    try {
      recognition = setupSpeechRecognition();
      if (recognition) recognition.start();
    } catch (_) {}

    const canHear = Boolean(useWindows || useCloudRecorder || recognition);
    updateStatus(canHear ? "Conectado · STT listo" : "Conectado · STT sin backend");
    updateSubtitle(greeting);
    speak(greeting, () => {
      if (canHear) {
        updateStatus(useWindows ? "Escuchando (Windows STT)..." : "Escuchando tu voz...");
        updateSubtitle("Habla naturalmente...");
      } else {
        updateStatus(sttInfo?.note || "STT no disponible");
        updateSubtitle("Configura Whisper/Gemini en Modelos");
      }
      if (window.EditCoreVoiceOrb) window.EditCoreVoiceOrb.setState("listening");
    });
  }

  async function stop(dispatchPending = true) {
    if (!isActive) return;
    if (stopInFlight) return stopInFlight;

    stopInFlight = (async () => {
      if (flushIntervalTimer) {
        clearInterval(flushIntervalTimer);
        flushIntervalTimer = null;
      }
      try {
        await flushCurrentAudioChunks(true);
      } catch (_) {}

      const pendingText = liveTranscript;
      isActive = false;
      isSpeaking = false;
      isProcessing = false;

      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      if (meterAnimId) {
        cancelAnimationFrame(meterAnimId);
        meterAnimId = null;
      }
      if (speechSynth) {
        try { speechSynth.cancel(); } catch (_) {}
      }
      if (recognition) {
        try { recognition.stop(); } catch (_) {}
        recognition = null;
      }
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        try { mediaRecorder.stop(); } catch (_) {}
        mediaRecorder = null;
      }
      if (audioStream) {
        try { audioStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
        audioStream = null;
      }
      if (audioContext && audioContext.state !== "closed") {
        try { audioContext.close(); } catch (_) {}
        audioContext = null;
      }

      await stopWindowsSttListener();

      if (window.EditCoreVoiceOrb) {
        try {
          window.EditCoreVoiceOrb.setState("idle");
          window.EditCoreVoiceOrb.stop();
        } catch (_) {}
      }

      const dom = getDom();
      if (dom.overlay) {
        dom.overlay.classList.add("hidden");
      }
      if (dom.voiceBtn) {
        dom.voiceBtn.classList.remove("active");
      }
      updateStatus("Listo");

      // Al colgar: texto pendiente del usuario → misma ruta que escribir (agente/chat).
      let dispatchedPending = false;
      if (dispatchPending && pendingText) {
        const cleaned = cleanQueryText(pendingText);
        if (cleaned && !isEchoOfTts(cleaned)) {
          pushCallTurn("user", cleaned);
          if (typeof optionsCallbacks.onSend === "function") {
            try {
              if (dom.prompt) dom.prompt.value = cleaned;
              optionsCallbacks.onSend(cleaned);
              dispatchedPending = true;
            } catch (_) {}
          }
        }
      }

      const transcript = formatCallTranscript();
      if (transcript && typeof optionsCallbacks.onCallEnded === "function") {
        try { optionsCallbacks.onCallEnded(transcript, callLog.slice()); } catch (_) {}
      } else if (!dispatchedPending && dispatchPending && pendingText) {
        const cleaned = cleanQueryText(pendingText);
        if (cleaned && typeof optionsCallbacks.onSend === "function") {
          if (dom.prompt) dom.prompt.value = cleaned;
          optionsCallbacks.onSend(cleaned);
        }
      }

      liveTranscript = "";
      callLog = [];
      lastSpokenFingerprint = "";
      lastTtsFingerprint = "";
      lastSttFailure = "";
      stopInFlight = null;
    })();

    return stopInFlight;
  }

  function toggle() {
    if (isActive) {
      void stop(true);
    } else {
      void start();
    }
  }

  function onAssistantMessage(text) {
    if (!isActive) return;
    const raw = String(text || "").trim();
    if (!raw) {
      isProcessing = false;
      notifyTurnComplete();
      return;
    }
    pushCallTurn("assistant", raw);
    isProcessing = false;
    updateSubtitle(cleanTextForSpeech(raw).slice(0, 150));
    speak(raw, () => {
      notifyTurnComplete();
    });
  }

  function notifyTurnComplete() {
    if (isActive && !isSpeaking) {
      isProcessing = false;
      updateStatus("Escuchando tu voz...");
      if (window.EditCoreVoiceOrb) {
        window.EditCoreVoiceOrb.setState("listening");
      }
    }
  }

  function init(options = {}) {
    if (typeof document === "undefined") return;
    if (options && typeof options === "object") {
      optionsCallbacks = { ...optionsCallbacks, ...options };
    }
    const dom = getDom();
    if (dom.hangupBtn && !dom.hangupBtn._bound) {
      dom.hangupBtn._bound = true;
      dom.hangupBtn.addEventListener("click", () => stop(true));
    }
    initVoices();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => init());
    } else {
      setTimeout(() => init(), 10);
    }
  }

  return {
    init,
    start,
    stop,
    toggle,
    isActive: () => isActive,
    speak,
    onAssistantMessage,
    notifyAssistant: onAssistantMessage,
    notifyTurnComplete,
    setPromptDispatcher: (fn) => { optionsCallbacks.onSend = fn; },
    isClosingPhrase,
    cleanQueryText,
    cleanTextForSpeech,
    formatCallTranscript,
    getTranscribeBridgeName: () => (typeof window !== "undefined" && window.editcoreApp?.transcribeAudio
      ? "editcoreApp"
      : (typeof window !== "undefined" && window.electronAPI?.transcribeAudio ? "electronAPI" : "")),
  };
});
