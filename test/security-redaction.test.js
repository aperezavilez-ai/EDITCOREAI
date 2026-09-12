"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { redactSensitive, sanitizeForLog } = require("../security-utils");

test("redacta claves etiquetadas, bearer tokens y credenciales en URLs", () => {
  const uuid = "12345678-1234-1234-1234-123456789abc";
  const input = `clave: ${uuid} Authorization: Bearer token-value-1234567890 https://example.test?api_key=${uuid}`;
  const output = redactSensitive(input);
  assert.doesNotMatch(output, /12345678-1234|token-value/);
  assert.match(output, /clave: \[REDACTED\]/i);
  assert.match(output, /api_key=\[REDACTED\]/);
});

test("redacta secretos dentro de progreso y errores anidados", () => {
  const output = sanitizeForLog({
    input: { content: "API_KEY=secret-value-1234567890", authorization: "another-secret" },
    result: { error: "Fallo con token: token-value-1234567890" },
  });
  assert.equal(output.input.authorization, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(output), /secret-value|another-secret|token-value/);
});
