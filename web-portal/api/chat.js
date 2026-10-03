// Serverless Function: POST /api/chat (Proxy Seguro ME AI con Control de Créditos)
// Flujo: verifica saldo → llama proveedor → descuenta créditos → registra en ledger

const SUPABASE_URL = process.env.SUPABASE_URL || "https://supabase.gafcore.com/editcore-ai";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ADMIN_EMAIL = "aperezavilez@gmail.com";

// Costo en créditos por cada 1,000 tokens (input + output combinado)
const MODEL_CREDIT_COST = {
  "claude-haiku-4-5":   0.2,
  "claude-haiku-3-5":   0.2,
  "deepseek-v4-pro":    0.3,
  "deepseek-chat":      0.3,
  "qwen3.6-plus":       0.3,
  "glm-5":              0.4,
  "kimi-k2.6":          0.4,
  "gemini-2.5-flash":   0.4,
  "gemini-flash":       0.4,
  "grok-4.5":           0.8,
  "claude-sonnet-4.6":  1.0,
  "claude-sonnet-4-6":  1.0,
  "claude-sonnet-3-7":  1.0,
  "gpt-5.6-luna":       1.5,
  "gpt-5.6-sol":        1.5,
  "gpt-5.6-terra":      1.5,
  "gpt-4o":             1.5,
  "claude-fable-5":     2.0,
  "claude-opus-4.8":    3.0,
  "claude-opus-4-8":    3.0,
  "claude-opus-4":      3.0,
};

const WARN_THRESHOLD = 10; // créditos para mostrar aviso

// ─── Helper: llamar Supabase REST API ─────────────────────────────────────────
async function supabaseRequest(path, method = "GET", body = null) {
  if (!SUPABASE_SERVICE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Prefer": method === "POST" ? "return=representation" : "return=minimal",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) return null;
  const text = await res.text();
  try { return JSON.parse(text); } catch { return null; }
}

// ─── Obtener perfil del usuario ────────────────────────────────────────────────
async function getUserProfile(userId) {
  const data = await supabaseRequest(`/profiles?id=eq.${userId}&select=id,email,credits_balance,is_unlimited,role`);
  return data && data.length > 0 ? data[0] : null;
}

// ─── Descontar créditos del usuario y registrar en ledger ───────────────────────
async function deductCredits(userId, creditsToDeduct, model, tokensIn, tokensOut, description) {
  const profile = await getUserProfile(userId);
  if (profile) {
    const newBalance = Math.max(0, (profile.credits_balance || 0) - creditsToDeduct);
    await supabaseRequest(`/profiles?id=eq.${userId}`, "PATCH", {
      credits_balance: newBalance,
      updated_at: new Date().toISOString(),
    });
  }

  // Registrar en credit_transactions (ledger)
  await supabaseRequest("/credit_transactions", "POST", {
    user_id: userId,
    amount: -creditsToDeduct,
    type: "usage_ai",
    model_used: model,
    tokens_input: tokensIn,
    tokens_output: tokensOut,
    description: description || `Uso de ${model} (${tokensIn + tokensOut} tokens)`,
    created_at: new Date().toISOString(),
  });
}

// ─── Descontar del Fondo Maestro ($8,000 USD / Tokens Globales) ───────────────
async function deductMasterLedger(tokensIn, tokensOut, model) {
  try {
    const totalTokens = (tokensIn || 0) + (tokensOut || 0);
    // Costo estimado en USD por millón según modelo
    let costPer1M = 3.0;
    const m = String(model || "").toLowerCase();
    if (m.includes("haiku") || m.includes("flash")) costPer1M = 0.8;
    else if (m.includes("deepseek")) costPer1M = 0.3;
    else if (m.includes("opus")) costPer1M = 15.0;

    const costUsd = (totalTokens / 1_000_000) * costPer1M;

    const rows = await supabaseRequest("/master_ledger?select=*&limit=1");
    if (rows && rows.length > 0) {
      const row = rows[0];
      const newConsUsd = Number(row.consumed_usd || 0) + Number(costUsd);
      const newConsTok = Number(row.consumed_tokens || 0) + Number(totalTokens);
      await supabaseRequest(`/master_ledger?id=eq.${row.id}`, "PATCH", {
        consumed_usd: newConsUsd,
        consumed_tokens: newConsTok,
        updated_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error("[MasterLedger Deduct Error]", err);
  }
}

// ─── Calcular créditos a cobrar ────────────────────────────────────────────────
function calcCredits(model, tokensIn, tokensOut) {
  const ratePerKToken = MODEL_CREDIT_COST[model] || 1.0;
  const totalTokens = (tokensIn || 0) + (tokensOut || 0);
  const credits = (totalTokens / 1000) * ratePerKToken;
  return Math.max(0.1, parseFloat(credits.toFixed(4))); // mínimo 0.1 créditos por llamada
}

// ─── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    model = "claude-sonnet-4-6",
    messages = [],
    userId = null,
    userEmail = null,
  } = req.body || {};

  const meaiBaseUrl = process.env.MEAI_BASE_URL || "https://api.meai.cloud/v1";
  const meaiApiKey = process.env.MEAI_API_KEY || "";

  // ── 1. Verificar saldo si tenemos userId ──────────────────────────────────────
  let profile = null;
  let isUnlimited = false;
  let currentBalance = 0;

  if (userId && SUPABASE_SERVICE_KEY) {
    profile = await getUserProfile(userId);

    if (profile) {
      isUnlimited = profile.is_unlimited || profile.email === ADMIN_EMAIL;
      currentBalance = parseFloat(profile.credits_balance || 0);

      // BLOQUEAR si saldo = 0 y no es admin
      if (!isUnlimited && currentBalance <= 0) {
        return res.status(402).json({
          error: "CREDITS_EXHAUSTED",
          message: "Tu saldo de créditos se ha agotado. Recarga para continuar usando EditCoreAI.",
          balance: 0,
          action: "recharge",
        });
      }
    }
  }

  // ── 2. Si no hay API key, devolver respuesta demo ─────────────────────────────
  if (!meaiApiKey) {
    const demoUsage = { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 };
    const creditsUsed = calcCredits(model, demoUsage.prompt_tokens, demoUsage.completion_tokens);

    if (profile && !isUnlimited) {
      await deductCredits(
        userId, creditsUsed, model,
        demoUsage.prompt_tokens, demoUsage.completion_tokens,
        `Demo: ${model}`
      );
      currentBalance -= creditsUsed;
    }
    // Descontar siempre del Fondo Maestro
    await deductMasterLedger(demoUsage.prompt_tokens, demoUsage.completion_tokens, model);

    return res.status(200).json({
      ok: true,
      choices: [{
        message: {
          role: "assistant",
          content: "✅ EditCoreAI funcionando. Configura tu MEAI_API_KEY en Vercel para respuestas reales.",
        },
      }],
      usage: demoUsage,
      credits_used: creditsUsed,
      credits_remaining: isUnlimited ? null : Math.max(0, currentBalance),
      low_balance: !isUnlimited && currentBalance < WARN_THRESHOLD,
    });
  }

  // ── 3. Llamar al proveedor de IA ──────────────────────────────────────────────
  try {
    const aiRes = await fetch(`${meaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${meaiApiKey}`,
      },
      body: JSON.stringify({ model, messages }),
    });

    const data = await aiRes.json();

    if (!aiRes.ok) {
      return res.status(aiRes.status).json(data);
    }

    // ── 4. Calcular y descontar créditos ──────────────────────────────────────
    const usage = data.usage || {};
    const tokensIn = usage.prompt_tokens || 0;
    const tokensOut = usage.completion_tokens || 0;
    const creditsUsed = calcCredits(model, tokensIn, tokensOut);
    let newBalance = currentBalance;

    if (profile && !isUnlimited && userId) {
      await deductCredits(userId, creditsUsed, model, tokensIn, tokensOut, `${model} — ${messages.length} mensajes`);
      newBalance = Math.max(0, currentBalance - creditsUsed);
    }

    // Descontar simultáneamente del Fondo Maestro global ($8,000 USD / tokens)
    await deductMasterLedger(tokensIn, tokensOut, model);

    // ── 5. Responder con metadata de créditos ─────────────────────────────────
    return res.status(200).json({
      ...data,
      credits_used: creditsUsed,
      credits_remaining: isUnlimited ? null : parseFloat(newBalance.toFixed(2)),
      low_balance: !isUnlimited && newBalance < WARN_THRESHOLD,
      balance_warning: !isUnlimited && newBalance < WARN_THRESHOLD
        ? `⚠️ Solo te quedan ${newBalance.toFixed(1)} créditos. Recarga pronto.`
        : null,
    });

  } catch (error) {
    return res.status(500).json({ error: error.message || "Error al conectar con proveedor ME AI." });
  }
};
