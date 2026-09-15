"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeChatProviderError,
  shouldQuarantineModelForAuto,
  isTransientProviderFailure,
  stripGafcoreMentions,
} = require("../runtime/chat-error-sanitize");
const AutoModel = require("../auto-model-selection");

test("sanitize: elimina GafCore Gateway del mensaje de timeout", () => {
  const raw = "APICredits no esta disponible o tardo demasiado en responder. Tu modelo seleccionado se conservo; reintenta en 30 segundos o actualiza las API keys en el admin de GafCore Gateway.";
  const out = sanitizeChatProviderError(raw);
  assert.match(out, /proveedor no respondi|Reintenta/i);
  assert.doesNotMatch(out, /gafcore/i);
  assert.doesNotMatch(out, /admin/i);
});

test("sanitize: stripGafcoreMentions", () => {
  assert.doesNotMatch(stripGafcoreMentions("Habla con GafCore Gateway ya"), /gafcore/i);
});

test("transient timeout NO cuarentena Auto", () => {
  const msg = "APICredits no esta disponible o tardo demasiado en responder";
  assert.equal(isTransientProviderFailure(msg, 503), true);
  assert.equal(shouldQuarantineModelForAuto(msg, 503), false);
  assert.equal(AutoModel.shouldQuarantineModelForAuto(msg), false);
});

test("auth SÍ cuarentena Auto", () => {
  assert.equal(shouldQuarantineModelForAuto("401 invalid token", 401), true);
  assert.equal(AutoModel.shouldQuarantineModelForAuto("modelo no permitido en la API"), true);
});
