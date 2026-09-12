"use strict";

/**
 * Privacy Mode: evita telemetria / envio de prompts a proveedores cloud
 * salvo modelos locales o cuando el usuario lo desactiva.
 */

const DEFAULT = {
  enabled: false,
  updatedAt: "",
  note: "Privacy Mode: bloquea llamadas cloud; permite local/offline.",
};

function normalize(raw = {}) {
  return {
    enabled: raw.enabled === true,
    updatedAt: String(raw.updatedAt || ""),
    note: String(raw.note || DEFAULT.note),
  };
}

function readPrivacyMode(secureState = {}) {
  return normalize(secureState.privacyMode || {});
}

function setPrivacyMode(secureState = {}, enabled = false) {
  const next = {
    ...secureState,
    privacyMode: {
      enabled: enabled === true,
      updatedAt: new Date().toISOString(),
      note: DEFAULT.note,
    },
  };
  return { state: next, privacyMode: next.privacyMode };
}

function assertCloudAllowed(privacyMode, providerKind = "") {
  if (!privacyMode?.enabled) return { ok: true };
  const kind = String(providerKind || "").toLowerCase();
  if (/local|ollama|lm.?studio|offline|none/.test(kind)) return { ok: true };
  return {
    ok: false,
    message: "Privacy Mode activo: no se envian prompts a proveedores cloud. Usa un modelo local o desactiva Privacy Mode.",
  };
}

module.exports = {
  readPrivacyMode,
  setPrivacyMode,
  assertCloudAllowed,
  DEFAULT,
};
