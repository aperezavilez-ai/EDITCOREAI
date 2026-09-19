"use strict";

/**
 * EDITCOREAI Voice Orb - Visualizador interactivo fluido en Canvas.
 * Renderiza un orbe de partículas y gradiente con 4 estados:
 * - idle: respiración suave
 * - listening: ondas reactivas al volumen del micrófono
 * - thinking: pulso rotatorio de energía de razonamiento
 * - speaking: ondas armónicas de voz mientras EDITCOREAI habla
 */

(function exposeVoiceOrb(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreVoiceOrb = api;
})(typeof window !== "undefined" ? window : globalThis, function createVoiceOrb() {
  let canvas = null;
  let ctx = null;
  let animId = null;
  let state = "idle"; // "idle" | "listening" | "thinking" | "speaking"
  let volume = 0;
  let targetVolume = 0;
  let time = 0;
  let size = 120;

  function init(targetCanvas) {
    if (!targetCanvas) return;
    canvas = targetCanvas;
    ctx = canvas.getContext("2d");
    size = Math.min(targetCanvas.width || 120, targetCanvas.height || 120) || 120;
    canvas.width = size;
    canvas.height = size;
    start();
  }

  function resize() {
    if (!canvas || !ctx) return;
    size = Math.min(canvas.clientWidth || canvas.width || 120, canvas.clientHeight || canvas.height || 120) || 120;
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
  }

  function setState(newState) {
    state = newState || "idle";
  }

  function setVolume(vol) {
    targetVolume = Math.min(1, Math.max(0, vol || 0));
  }

  function render() {
    if (!ctx || !canvas) return;
    const w = canvas.width || size;
    const h = canvas.height || size;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    time += 0.035;
    volume += (targetVolume - volume) * 0.2;

    const baseRadius = size * 0.26;
    let radius = baseRadius;
    let color1 = "#6366f1";
    let color2 = "#3b82f6";
    let color3 = "#06b6d4";

    if (state === "listening") {
      radius = baseRadius + volume * (size * 0.16);
      color1 = "#10b981";
      color2 = "#06b6d4";
      color3 = "#3b82f6";
    } else if (state === "thinking") {
      radius = baseRadius + Math.sin(time * 3) * (size * 0.06);
      color1 = "#f59e0b";
      color2 = "#ec4899";
      color3 = "#8b5cf6";
    } else if (state === "speaking") {
      radius = baseRadius + Math.sin(time * 4) * (size * 0.08) + volume * (size * 0.1);
      color1 = "#38bdf8";
      color2 = "#818cf8";
      color3 = "#c084fc";
    } else {
      radius = baseRadius + Math.sin(time * 1.5) * 3;
    }

    // Outer glow waves
    const waves = state === "listening" || state === "speaking" ? 3 : 2;
    for (let i = waves; i >= 1; i--) {
      const waveRadius = radius + i * 10 + Math.sin(time * 2 + i) * 4;
      const alpha = Math.max(0, 0.22 - i * 0.06);
      const grad = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, cy, waveRadius);
      grad.addColorStop(0, color1);
      grad.addColorStop(0.6, color2);
      grad.addColorStop(1, "transparent");

      ctx.beginPath();
      ctx.arc(cx, cy, waveRadius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.globalAlpha = alpha;
      ctx.fill();
    }

    // Core Orb Gradient
    const coreGrad = ctx.createRadialGradient(
      cx - radius * 0.3,
      cy - radius * 0.3,
      radius * 0.1,
      cx,
      cy,
      radius
    );
    coreGrad.addColorStop(0, "#ffffff");
    coreGrad.addColorStop(0.3, color3);
    coreGrad.addColorStop(0.7, color2);
    coreGrad.addColorStop(1, color1);

    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = coreGrad;
    ctx.shadowColor = color2;
    ctx.shadowBlur = state === "thinking" || state === "speaking" ? 22 : 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Internal Energy Rings for Thinking / Speaking
    if (state === "thinking" || state === "speaking") {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(time * 2);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.7, 0, Math.PI * 1.2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.stroke();

      ctx.rotate(-time * 3);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.45, 0, Math.PI * 0.9);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    animId = requestAnimationFrame(render);
  }

  function start() {
    if (animId) return;
    render();
  }

  function stop() {
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  function destroy() {
    stop();
    ctx = null;
    canvas = null;
  }

  return {
    init,
    resize,
    setState,
    getState: () => state,
    setVolume,
    getVolume: () => targetVolume,
    start,
    stop,
    destroy,
  };
});
