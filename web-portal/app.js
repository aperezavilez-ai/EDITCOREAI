// EDITCOREAI Web Portal — Client Engine v4.1.0
// Supabase como fuente de verdad para créditos (mismo paraguas que Desktop)
const SUPABASE_URL = "https://supabase.gafcore.com/editcore-ai";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg5ODQ5MzMyLCJleHAiOjIxMDUyMDkzMzJ9.3LsN9Eis_cCkPT9sWJQwM9RmreAqM8-7Io0Uv2RqkdQ";
const ADMIN_EMAIL = "aperezavilez@gmail.com";

let supabase = null;
try {
  if (typeof window.supabase?.createClient === "function") {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (e) {
  console.warn("Supabase init:", e);
}

let isSignUp = false;
let currentUser = null;        // Supabase User object
let currentSession = null;     // Supabase Session (tiene access_token)
let userProfile = null;        // Perfil con credits_balance de la tabla profiles

function $(id) { return document.getElementById(id); }

// ─── Funciones de créditos ──────────────────────────────────────────────────

async function fetchUserProfile() {
  if (!currentUser || !currentSession) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${currentUser.id}&select=id,email,credits_balance,is_unlimited,role`,
      {
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${currentSession.access_token}`,
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.length > 0 ? data[0] : null;
  } catch { return null; }
}

function isAdmin() {
  return currentUser?.email === ADMIN_EMAIL ||
    userProfile?.is_unlimited === true ||
    userProfile?.role === "admin";
}

function getDisplayBalance() {
  if (!userProfile) return null;
  if (isAdmin()) return "∞";
  return parseFloat(userProfile.credits_balance || 0).toFixed(1);
}

function updateCreditsDisplay() {
  const creditBadge = $("creditsBadge");
  if (!creditBadge) return;
  if (!currentUser) { creditBadge.hidden = true; return; }
  const bal = getDisplayBalance();
  creditBadge.hidden = false;
  creditBadge.textContent = bal === "∞" ? "⚡ Ilimitado" : `💳 ${bal} créditos`;
  creditBadge.style.color = (bal !== "∞" && parseFloat(bal) < 10) ? "#f59e0b" : "";
}

// ─── Modal de autenticación ─────────────────────────────────────────────────

function openAuthModal(signUpMode = false) {
  isSignUp = signUpMode;
  const modal = $("authModal");
  if ($("authMsg")) $("authMsg").hidden = true;
  if (isSignUp) {
    if ($("authTitle")) $("authTitle").textContent = "Crear Cuenta en EditCoreAI";
    if ($("authSubmitBtn")) $("authSubmitBtn").textContent = "Registrarme y Obtener 25 Créditos";
    if ($("authToggleText")) $("authToggleText").textContent = "¿Ya tienes cuenta?";
    if ($("authToggleBtn")) $("authToggleBtn").textContent = "Inicia sesión";
  } else {
    if ($("authTitle")) $("authTitle").textContent = "Acceso a EditCoreAI";
    if ($("authSubmitBtn")) $("authSubmitBtn").textContent = "Iniciar Sesión";
    if ($("authToggleText")) $("authToggleText").textContent = "¿No tienes cuenta?";
    if ($("authToggleBtn")) $("authToggleBtn").textContent = "Regístrate gratis (25 créditos)";
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

// ─── DOMContentLoaded ───────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  // Detectar ruta especial
  if (window.location.pathname.includes("login") || window.location.hash.includes("login")) {
    openAuthModal(false);
  } else if (window.location.pathname.includes("register") || window.location.hash.includes("register")) {
    openAuthModal(true);
  }

  // Restaurar sesión existente de Supabase
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      currentSession = data.session;
      currentUser = data.session.user;
      userProfile = await fetchUserProfile();
      updateNavUserUI();
      updateCreditsDisplay();
    }

    // Escuchar cambios de sesión
    supabase.auth.onAuthStateChange(async (event, session) => {
      currentSession = session;
      currentUser = session?.user || null;
      if (currentUser) {
        userProfile = await fetchUserProfile();
      } else {
        userProfile = null;
      }
      updateNavUserUI();
      updateCreditsDisplay();
    });
  }

  // Botón Login/Logout en navbar
  $("webAuthBtn")?.addEventListener("click", () => {
    if (currentUser) {
      if (confirm(`Sesión activa: ${currentUser.email}\n¿Deseas cerrar sesión?`)) {
        supabase?.auth?.signOut();
        currentUser = null;
        currentSession = null;
        userProfile = null;
        updateNavUserUI();
        updateCreditsDisplay();
      }
    } else {
      openAuthModal(false);
    }
  });

  $("openWebIdeBtn")?.addEventListener("click", () => {
    if (!currentUser) {
      openAuthModal(false);
    } else {
      alert(`¡Bienvenido a EditCore Web, ${currentUser.email}!\nAbriendo tu espacio de trabajo...`);
    }
  });

  $("authCloseBtn")?.addEventListener("click", closeAuthModal);
  $("authToggleBtn")?.addEventListener("click", () => openAuthModal(!isSignUp));

  // Formulario de login / registro
  $("authForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("authEmail")?.value?.trim();
    const password = $("authPassword")?.value?.trim();
    const msg = $("authMsg");
    const submitBtn = $("authSubmitBtn");
    if (!email || !password) return;
    if (submitBtn) submitBtn.disabled = true;

    try {
      if (isSignUp) {
        if (supabase) {
          const { data, error } = await supabase.auth.signUp({ email, password });
          if (error) throw error;
          currentUser = data.user;
          currentSession = data.session;
          if (msg) { msg.hidden = false; msg.style.color = "#22c55e";
            msg.textContent = "✅ Cuenta creada. Revisa tu correo para confirmar."; }
          setTimeout(closeAuthModal, 2500);
        }
      } else {
        if (supabase) {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
          currentUser = data.user;
          currentSession = data.session;
          userProfile = await fetchUserProfile();
          updateNavUserUI();
          updateCreditsDisplay();
          closeAuthModal();

          // Bienvenida con saldo
          const bal = getDisplayBalance();
          const balMsg = bal === "∞" ? "Acceso ilimitado activo ⚡" : `Saldo: ${bal} créditos 💳`;
          alert(`¡Bienvenido, ${currentUser.email}!\n${balMsg}`);
        } else {
          // Fallback sin Supabase (modo demo)
          currentUser = { email, id: "demo", role: email === ADMIN_EMAIL ? "admin" : "user" };
          updateNavUserUI();
          closeAuthModal();
        }
      }
    } catch (err) {
      if (msg) {
        msg.hidden = false;
        msg.style.color = "#ef4444";
        msg.textContent = err.message || "Error al autenticar. Verifica tus credenciales.";
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // ─── Botones de compra de créditos ─────────────────────────────────────────
  document.querySelectorAll(".ec-pricing-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const credits = btn.getAttribute("data-pack") || "100";
      if (!currentUser) { openAuthModal(false); return; }

      const gw = confirm(
        "¿Deseas pagar con Mercado Pago (OXXO/SPEI/Tarjeta)?\n\nPresiona [Aceptar] para Mercado Pago\n[Cancelar] para Stripe."
      ) ? "mercadopago" : "stripe";

      try {
        const res = await fetch("/api/create-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: currentUser.id,
            userEmail: currentUser.email,
            packCredits: parseInt(credits, 10),
            gateway: gw,
          }),
        });
        const data = await res.json();
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
        } else {
          alert(`✅ Orden de ${credits} créditos generada para ${currentUser.email}.\nRecibirás confirmación por correo.`);
        }
      } catch {
        alert(`✅ Orden de ${credits} créditos registrada para ${currentUser.email}.`);
      }
    });
  });
});

// ─── UI helpers ─────────────────────────────────────────────────────────────

function updateNavUserUI() {
  const btn = $("webAuthBtn");
  if (!btn) return;
  if (currentUser) {
    const admn = currentUser.email === ADMIN_EMAIL || userProfile?.role === "admin";
    btn.textContent = admn ? "👑 Admin (Ilimitado)" : `👤 ${currentUser.email.split("@")[0]}`;
    btn.className = "ec-btn-primary";
  } else {
    btn.textContent = "Iniciar Sesión";
    btn.className = "ec-btn-secondary";
  }
}

// ─── API de chat con control de créditos ────────────────────────────────────
// Función global para que cualquier sección del portal pueda enviar mensajes
window.editcoreChat = async function(messages, model = "claude-sonnet-4-6") {
  if (!currentUser) { openAuthModal(false); return null; }

  // Verificar saldo local antes de llamar
  if (!isAdmin() && userProfile && parseFloat(userProfile.credits_balance || 0) <= 0) {
    openRechargeModal();
    return { error: "CREDITS_EXHAUSTED", message: "Saldo agotado. Recarga tus créditos." };
  }

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      userId: currentUser.id,
      userEmail: currentUser.email,
    }),
  });

  const data = await res.json();

  // Créditos agotados en servidor
  if (res.status === 402 || data.error === "CREDITS_EXHAUSTED") {
    openRechargeModal();
    if (userProfile) userProfile.credits_balance = 0;
    updateCreditsDisplay();
    return data;
  }

  // Actualizar saldo mostrado en UI
  if (data.credits_remaining !== null && data.credits_remaining !== undefined) {
    if (userProfile) userProfile.credits_balance = data.credits_remaining;
    updateCreditsDisplay();
  }

  // Aviso de saldo bajo
  if (data.low_balance && data.balance_warning) {
    console.warn(data.balance_warning);
    const balBadge = $("creditsBadge");
    if (balBadge) { balBadge.style.color = "#f59e0b"; balBadge.title = data.balance_warning; }
  }

  return data;
};
