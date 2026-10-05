"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const { scrubAiProviderNames } = require("../renderer-markdown");
const { sanitizeChatProviderError } = require("../runtime/chat-error-sanitize");
const { ELITE_COMMUNICATION_POLICY } = require("../runtime/elite-communication-policy");
const { webPersonaPrompt } = require("../scripts/write-web-config");
const PROVIDER_RE = /ME\s?AI|meai|API\s?Credits/i;

test("las respuestas nunca muestran los proveedores de IA, sí los modelos", () => {
  const cases = [
    "**Modelos:** ME AI y APICredits con tus API keys en el panel Modelos.",
    "Usa Modelos → ME AI / APICredits.",
    "Estoy corriendo en ME AI Cloud con meai/claude-sonnet-4.6.",
    "El endpoint es https://api.meai.cloud/v1 y también api.apicredits.site.",
    "Proveedor: MeAI, apicredits.",
  ];
  for (const text of cases) assert.doesNotMatch(scrubAiProviderNames(text), PROVIDER_RE, text);
  assert.match(scrubAiProviderNames("Estoy corriendo con meai/claude-sonnet-4.6."), /claude-sonnet-4\.6/);
  assert.equal(scrubAiProviderNames("Soy Claude Sonnet 4.6."), "Soy Claude Sonnet 4.6.");
});

test("errores del chat sin nombres de proveedores", () => {
  for (const raw of ["402 sin saldo en APICredits", "ME AI: clave rechazada", "APICredits: modelo raro"]) {
    assert.doesNotMatch(sanitizeChatProviderError(raw), PROVIDER_RE, raw);
  }
});

test("la IA tiene la regla de no nombrar proveedores (IDE y web) y no recibe sus nombres", () => {
  assert.match(ELITE_COMMUNICATION_POLICY, /NUNCA nombres a los proveedores/);
  assert.match(webPersonaPrompt(), /NUNCA nombres a los proveedores/);
  for (const file of [
    "runtime/elite-communication-policy.js",
    "runtime/operator-connections-context.js",
    "runtime/intent-orchestrator.js",
    "runtime/jarvis-port.js",
  ]) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8").replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, "");
    assert.doesNotMatch(source, /ME AI|APICredits/, file);
  }
});

test("el IDE y la web filtran solo las respuestas, no lo que escribe el usuario", () => {
  const renderer = fs.readFileSync(path.join(ROOT, "renderer.js"), "utf8");
  assert.match(renderer, /if \(!fromUser && typeof window\.scrubAiProviderNames === "function"\)/);
  assert.match(renderer, /renderMarkdown\(text, \{ fromUser: true \}\)/);
  assert.doesNotMatch(renderer.slice(renderer.indexOf("function localAppInfoAnswer("), renderer.indexOf("function isUserStopCommand(")), PROVIDER_RE);
  const bridge = fs.readFileSync(path.join(ROOT, "web-portal/js/web-bridge.js"), "utf8");
  assert.match(bridge, /if \(!fromUser && typeof window\.scrubAiProviderNames === "function"\)/);
  assert.match(bridge, /renderMarkdown\(text, \{ fromUser: role === "user" \}\)/);
});
