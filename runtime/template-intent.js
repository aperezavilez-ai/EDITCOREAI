"use strict";

/**
 * Seleccion determinista de plantilla de proyecto desde el prompt del usuario.
 * Las plantillas NO viven en la UI: el agente las elige aqui / via Cerebro.
 */

const TEMPLATE_RULES = Object.freeze([
  {
    id: "enterprise-erp-base",
    score: (t) => (
      (/\berp\b/i.test(t) ? 100 : 0)
      + (/\b(crm|inventario|n[oó]mina|facturaci[oó]n|multi[- ]?tenant|multi[- ]?sucursal)\b/i.test(t) ? 85 : 0)
      + (/\b(rbac|roles?|permisos)\b/i.test(t) && /\b(empresa|enterprise|saas)\b/i.test(t) ? 70 : 0)
    ),
  },
  {
    id: "next-saas",
    score: (t) => (
      (/\bnext(?:\.?js)?\b/i.test(t) && /\b(saas|stripe|drizzle|postgres)\b/i.test(t) ? 100 : 0)
      + (/\bsaas\b/i.test(t) && /\bnext\b/i.test(t) ? 90 : 0)
      + (/\bsaas\s+profesional\b/i.test(t) ? 70 : 0)
    ),
  },
  {
    id: "web-pro",
    score: (t) => (
      (/\b(react|vite)\b/i.test(t) && /\b(supabase|shadcn)\b/i.test(t) ? 95 : 0)
      + (/\bweb\s+app\s+profesional\b/i.test(t) ? 80 : 0)
      + (/\breact\b/i.test(t) && /\bvite\b/i.test(t) && /\b(supabase|formularios?)\b/i.test(t) ? 90 : 0)
    ),
  },
  {
    id: "open-saas",
    score: (t) => (/\b(open\s*saas|wasp)\b/i.test(t) ? 100 : 0),
  },
  {
    id: "soundonemusic",
    score: (t) => (/\b(suno|soundone|lyrics|style\s+prompt)\b/i.test(t) ? 100 : 0),
  },
  {
    id: "react",
    score: (t) => (
      (/\breact\b/i.test(t) && /\bvite\b/i.test(t) ? 70 : 0)
      + (/\breact\b/i.test(t) && !/\b(next|supabase|saas)\b/i.test(t) ? 55 : 0)
    ),
  },
  {
    id: "node",
    score: (t) => (/\b(node\.?js|express|api\s+node)\b/i.test(t) && !/\b(react|next|vite)\b/i.test(t) ? 60 : 0),
  },
  {
    id: "web",
    score: (t) => (/\b(html|css|est[aá]tic[oa]|sin\s+framework)\b/i.test(t) ? 50 : 0),
  },
  {
    id: "blank",
    score: (t) => (/\b(vac[ií]o|en\s+blanco|blank|minimal|esqueleto)\b/i.test(t) ? 40 : 0),
  },
]);

const TEMPLATE_LABELS = Object.freeze({
  blank: "Proyecto vacio",
  web: "Web HTML",
  node: "Node.js",
  react: "React + Vite",
  "web-pro": "Web App profesional (React/Vite/Supabase)",
  "enterprise-erp-base": "Enterprise ERP (RBAC + multi-tenant + schema-first)",
  "next-saas": "SaaS Next.js",
  "open-saas": "Open SaaS (Wasp)",
  soundonemusic: "SOUNDONEMUSIC",
});

function resolveTemplateIntent(prompt = "", options = {}) {
  const text = String(prompt || "").trim();
  const hinted = String(options.template || options.templateId || "").trim().toLowerCase();
  if (hinted && hinted !== "auto") {
    return { id: hinted, confidence: 1, source: "explicit" };
  }
  let best = { id: "blank", score: 0 };
  for (const rule of TEMPLATE_RULES) {
    const score = Number(rule.score(text) || 0);
    if (score > best.score) best = { id: rule.id, score };
  }
  if (best.score <= 0) {
    if (/\b(crea|crear|monta|genera)\b/i.test(text)
      && /\b(app|web|landing|dashboard|saas)\b/i.test(text)
      && /\b(profesional|moderna|pulida|shadcn|tailwind)\b/i.test(text)) {
      return { id: "web-pro", confidence: 0.6, source: "heuristic" };
    }
    return { id: "blank", confidence: 0.2, source: "default" };
  }
  return {
    id: best.id,
    confidence: Math.min(1, best.score / 100),
    source: "intent",
  };
}

function describeTemplateChoice(choice = {}) {
  const id = String(choice.id || "blank");
  return TEMPLATE_LABELS[id] || id;
}

module.exports = {
  resolveTemplateIntent,
  describeTemplateChoice,
  TEMPLATE_RULES,
  TEMPLATE_LABELS,
};
