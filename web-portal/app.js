// EDITCOREAI Web Portal — Client Engine
// Sesión, saldo y pagos viven en el servidor de cuentas (window.EditCoreCuentas:
// la misma cuenta de Google, saldo y recargas que la app de escritorio).
//
// RETIRADO (corrección de la versión web): este archivo traía un segundo motor
// de cuentas —cliente propio contra el proyecto legado de Supabase, login por
// correo+contraseña y saldo leído de una tabla de perfiles por REST— y los
// botones de precios posteaban a un endpoint stub que fabricaba la URL de
// pago. Todo eso se eliminó: el login es Google vía cuentas.js y la recarga
// real es EditCoreCuentas.createCheckout (función payments del servidor).

let sessionUser = null; // Usuario de la sesión de Google (cuentas)
let account = null;     // Cuenta del servidor: credits_balance, role, is_unlimited, status

function $(id) { return document.getElementById(id); }
const cuentas = () => window.EditCoreCuentas || null;

// ─── Saldo (siempre el del servidor de cuentas) ─────────────────────────────

async function refreshAccount() {
  const C = cuentas();
  if (!C || !C.hasSession || !C.hasSession()) {
    sessionUser = null;
    account = null;
  } else {
    sessionUser = C.sessionUser ? C.sessionUser() : null;
    try {
      account = await C.account();
    } catch {
      account = null; // sin respuesta del servidor no se inventa saldo
    }
  }
  updateNavUserUI();
  updateCreditsDisplay();
  return account;
}

function isAdmin() {
  const C = cuentas();
  return Boolean(account && (account.role === "admin" || (C && C.isUnlimited && C.isUnlimited(account))));
}

function getDisplayBalance() {
  if (!account) return null;
  if (isAdmin() || account.is_unlimited === true) return "∞";
  return Number(account.credits_balance || 0).toFixed(1);
}

function updateCreditsDisplay() {
  const creditBadge = $("creditsBadge");
  if (!creditBadge) return;
  if (!sessionUser) { creditBadge.hidden = true; return; }
  const bal = getDisplayBalance();
  creditBadge.hidden = false;
  creditBadge.textContent = bal === "∞" ? "⚡ Ilimitado" : `💳 ${bal ?? "…"} créditos`;
  creditBadge.style.color = (bal !== "∞" && bal !== null && parseFloat(bal) < 10) ? "#f59e0b" : "";
}

// ─── Modal de autenticación (Google) ────────────────────────────────────────

function openAuthModal(signUpMode = false) {
  const modal = $("authModal");
  if ($("authMsg")) $("authMsg").hidden = true;
  if ($("authTitle")) $("authTitle").textContent = signUpMode ? "Crear Cuenta en EditCoreAI" : "Acceso a EditCoreAI";
  if ($("authSubtitle")) {
    $("authSubtitle").textContent = signUpMode
      ? "Entra con Google: tu cuenta se crea sola y recibes el saldo de bienvenida de 2 USD."
      : "Ingresa para sincronizar tus créditos y proyectos.";
  }
  if (modal) { modal.hidden = false; modal.removeAttribute("hidden"); modal.setAttribute("aria-hidden", "false"); }
}

function closeAuthModal() {
  const modal = $("authModal");
  if (modal) { modal.hidden = true; modal.setAttribute("hidden", ""); modal.setAttribute("aria-hidden", "true"); }
}

// Modal de recarga de créditos
function openRechargeModal() {
  // Si hay un modal de recarga, abrirlo; si no, scroll a sección precios
  const rechargeModal = $("rechargeModal");
  if (rechargeModal) {
    rechargeModal.hidden = false;
    rechargeModal.removeAttribute("hidden");
  } else {
    const pricingSection = document.querySelector(".ec-pricing") || document.querySelector("[id*='precio']");
    if (pricingSection) pricingSection.scrollIntoView({ behavior: "smooth" });
  }
}

// La URL de pago solo es válida si es un checkout real de Mercado Pago
// (la misma validación que usa el puente del IDE web).
function isMercadoPagoCheckoutUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && /(^|\.)mercadopago\.com(\.[a-z]{2})?$|(^|\.)mercadolibre\.com$|^mpago\.(la|li)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

// ─── DOMContentLoaded ───────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const C = cuentas();

  // Si Google devolvió el código de login sobre esta página, se canjea aquí.
  if (C && C.completeLoginFromUrl) {
    try { await C.completeLoginFromUrl(); } catch { /* el aviso queda en el botón de login */ }
  }
  await refreshAccount();

  // Detectar ruta especial
  if (window.location.pathname.includes("login") || window.location.hash.includes("login")) {
    openAuthModal(false);
  } else if (window.location.pathname.includes("register") || window.location.hash.includes("register")) {
    openAuthModal(true);
  }

  // Botón Login/Logout en navbar: con sesión cierra sesión; sin sesión el
  // enlace <a> navega directo a login.html (Google).
  $("webAuthBtn")?.addEventListener("click", async (e) => {
    if (!sessionUser) return;
    e.preventDefault();
    if (confirm(`Sesión activa: ${sessionUser.email || ""}\n¿Deseas cerrar sesión?`)) {
      try { await cuentas()?.logout(); } catch { /* la sesión local ya quedó cerrada */ }
      window.location.reload();
    }
  });

  // Entrar con Google (único login: la misma cuenta que la app de escritorio)
  $("authGoogleBtn")?.addEventListener("click", async () => {
    const msg = $("authMsg");
    const btn = $("authGoogleBtn");
    if (btn) btn.disabled = true;
    try {
      if (!C || !C.isConfigured || !C.isConfigured()) throw new Error("La web no está conectada al servidor de cuentas en este momento. Intenta más tarde o usa la app de escritorio.");
      await C.startGoogleLogin("/app.html");
    } catch (err) {
      if (msg) {
        msg.hidden = false;
        msg.style.color = "#ef4444";
        msg.textContent = err?.message || "No se pudo iniciar sesión con Google.";
      }
      if (btn) btn.disabled = false;
    }
  });

  // Funciones de control de Web Studio
  async function openWebStudio() {
    if (!cuentas()?.hasSession?.()) {
      openAuthModal(false);
      return;
    }
    const studio = $("webStudioModal");
    if (studio) {
      studio.hidden = false;
      studio.removeAttribute("hidden");
      studio.setAttribute("aria-hidden", "false");
      const badge = $("studioUserBadge");
      if (badge) badge.textContent = sessionUser?.email || "Sesión de desarrollo activa";
      await refreshAccount();
      const credBadge = $("studioCreditsBadge");
      if (credBadge) {
        const bal = getDisplayBalance();
        credBadge.textContent = bal === "∞" ? "⚡ Ilimitado" : `💳 ${bal ?? "…"} créditos`;
      }
      setTimeout(() => $("studioPrompt")?.focus(), 150);
    }
  }

  function closeWebStudio() {
    const studio = $("webStudioModal");
    if (studio) {
      studio.hidden = true;
      studio.setAttribute("hidden", "");
      studio.setAttribute("aria-hidden", "true");
    }
  }

  $("studioCloseBtn")?.addEventListener("click", closeWebStudio);

  // Cerrar modales haciendo clic en el fondo
  $("authModal")?.addEventListener("click", (e) => {
    if (e.target === $("authModal")) closeAuthModal();
  });
  $("webStudioModal")?.addEventListener("click", (e) => {
    if (e.target === $("webStudioModal")) closeWebStudio();
  });

  // Envío interactivo de requerimientos en Web Studio
  $("studioForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const promptInput = $("studioPrompt");
    const sendBtn = $("studioSendBtn");
    const chat = $("studioChat");
    const text = promptInput?.value?.trim();
    if (!text) return;

    const userMsg = document.createElement("div");
    userMsg.className = "studio-msg studio-msg-user";
    userMsg.textContent = text;
    chat?.appendChild(userMsg);
    promptInput.value = "";
    if (sendBtn) sendBtn.disabled = true;

    const aiMsg = document.createElement("div");
    aiMsg.className = "studio-msg studio-msg-ai";
    aiMsg.textContent = "⚙️ EditCoreAI procesando tu requerimiento...";
    chat?.appendChild(aiMsg);
    chat.scrollTop = chat.scrollHeight;

    try {
      const resp = await window.editcoreChat([{ role: "user", content: text }]);
      if (resp?.reply) {
        aiMsg.textContent = resp.reply;
      } else if (resp?.error) {
        aiMsg.textContent = `⚠️ ${resp.message || "Error al procesar consulta."}`;
      } else {
        aiMsg.textContent = "Requerimiento completado correctamente.";
      }
    } catch (err) {
      aiMsg.textContent = `⚠️ Error de conexión: ${err.message}`;
    } finally {
      if (sendBtn) sendBtn.disabled = false;
      await refreshAccount();
      const credBadge = $("studioCreditsBadge");
      if (credBadge) {
        const bal = getDisplayBalance();
        credBadge.textContent = bal === "∞" ? "⚡ Ilimitado" : `💳 ${bal ?? "…"} créditos`;
      }
      chat.scrollTop = chat.scrollHeight;
    }
  });

  $("authCloseBtn")?.addEventListener("click", closeAuthModal);

  // ─── Botones de compra de créditos ───────────────────────────────────────
  // La compra va al flujo REAL: EditCoreCuentas.createCheckout (función
  // payments del servidor, que acredita el saldo al confirmarse el pago).
  // Si el checkout no responde, se intenta el enlace de pago configurado por
  // el administrador (paymentOffer). Nunca se fabrica una URL ni se anuncia
  // una orden que no existe.
  document.querySelectorAll(".ec-pricing-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const C2 = cuentas();
      if (!C2 || !C2.isConfigured || !C2.isConfigured()) {
        alert("La recarga en línea no está disponible en este momento. Entra a la app de EditCoreAI para recargar tu saldo.");
        return;
      }
      if (!C2.hasSession()) { openAuthModal(false); return; }
      btn.disabled = true;
      try {
        const res = await C2.createCheckout();
        if (res?.url && isMercadoPagoCheckoutUrl(res.url)) {
          window.location.href = res.url;
          return;
        }
        throw new Error("checkout-sin-url");
      } catch {
        try {
          const offer = await C2.paymentOffer();
          if (offer?.ok && offer.payment_link && isMercadoPagoCheckoutUrl(offer.payment_link)) {
            window.location.href = offer.payment_link;
            return;
          }
        } catch { /* se cae al aviso honesto */ }
        alert("No pudimos abrir el pago en línea. Entra a la app de EditCoreAI y recarga desde tu cuenta: ahí el pago se acredita a tu saldo.");
      } finally {
        btn.disabled = false;
      }
    });
  });
});

// ─── UI helpers ─────────────────────────────────────────────────────────────

function updateNavUserUI() {
  const btn = $("webAuthBtn");
  if (!btn) return;
  if (sessionUser) {
    btn.textContent = isAdmin() ? "👑 Admin (Ilimitado)" : `👤 ${(sessionUser.email || "").split("@")[0] || "Mi cuenta"}`;
  } else {
    btn.textContent = "Iniciar Sesión";
  }
}

// ─── API de chat: pasa por el ai-proxy del servidor de cuentas ─────────────
// Función global para que cualquier sección del portal pueda enviar mensajes.
// El chat usa la función ai-proxy de Supabase vía window.EditCoreCuentas:
// el servidor verifica la sesión y el saldo, llama al proveedor con la llave del
// administrador y descuenta el consumo real. Contrato de retorno: { reply } o { error, message }.
window.editcoreChat = Object.assign(async function(messages, model = "claude-sonnet-4-6") {
  if (!cuentas()?.hasSession?.()) { openAuthModal(false); return null; }
  const C = window.EditCoreCuentas;
  if (!C || typeof C.chat !== "function") {
    return { error: "NOT_CONFIGURED", message: "El chat web todavía no está conectado al servidor de EditCoreAI." };
  }

  // El proveedor publica el mismo modelo con nombres distintos (claude-sonnet-4.6 / -4-6):
  // se resuelve contra la lista real del servidor, igual que el agente web.
  let resolvedModel = model;
  try {
    const list = await C.listModels();
    if (Array.isArray(list) && list.length && !list.includes(model)) {
      resolvedModel = list.find((m) => /claude-sonnet-4[.-]6/i.test(m)) || list.find((m) => /claude-sonnet/i.test(m)) || list[0];
    }
  } catch { /* si la lista no responde, el servidor devuelve el error al chatear */ }

  try {
    const reply = await C.chat({ model: resolvedModel, messages });
    return { reply };
  } catch (err) {
    if (err && (err.status === 402 || err.code === "OUT_OF_CREDITS")) {
      openRechargeModal();
      return { error: "CREDITS_EXHAUSTED", message: err.message || "Saldo agotado. Recarga tus créditos." };
    }
    return { error: err?.code || "SERVER", message: err?.message || "Error al procesar consulta." };
  }
}, window.editcoreChat || {});
