"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../scripts/lib/supabase-keys");

test("generateKeySet firma anon/service_role con el secreto nuevo y no es detectado como por defecto", () => {
  const keys = lib.generateKeySet({ projectRef: "taxidriv" });
  assert.ok(keys.JWT_SECRET.length >= 60);
  assert.equal(lib.decodeJwtPayload(keys.ANON_KEY).role, "anon");
  assert.equal(lib.decodeJwtPayload(keys.SERVICE_ROLE_KEY).role, "service_role");
  assert.ok(lib.verifyHs256Jwt(keys.ANON_KEY, keys.JWT_SECRET));
  assert.ok(!lib.verifyHs256Jwt(keys.ANON_KEY, "otro-secreto"));
  assert.match(keys.PUBLISHABLE_KEY, /^sb_publishable_/);
  assert.match(keys.SECRET_KEY, /^sb_secret_/);
  assert.deepEqual(lib.detectDefaultKeys(keys), []);
});

test("detectDefaultKeys reconoce tokens demo por su emisor", () => {
  const demoAnon = lib.signHs256Jwt({ iss: "supabase-demo", role: "anon" }, "x".repeat(40));
  assert.deepEqual(lib.detectDefaultKeys({ ANON_KEY: demoAnon }), ["ANON_KEY"]);
});

test("applyAuthKeyConfig referencia supabase/.env dentro de [auth] sin tocar subtablas", () => {
  const toml = "[api]\nschemas = [\"public\"]\n\n[auth]\nsite_url = \"https://x.com\"\n\n[auth.email]\nenable_confirmations = true\n";
  const out = lib.applyAuthKeyConfig(toml);
  const auth = out.split("[auth.email]")[0].split("[auth]")[1];
  for (const field of ["jwt_secret", "anon_key", "service_role_key", "publishable_key", "secret_key"]) {
    assert.match(auth, new RegExp(`${field} = "env\\(SUPABASE_AUTH_`));
  }
  assert.equal(lib.applyAuthKeyConfig(out), out);
  const pinned = lib.upsertTomlField(out, "api", "port", "54325");
  assert.equal(lib.readTomlNumber(pinned, "api", "port"), 54325);
});

test("clave de firma ES256 y JWKS de PostgREST sin la parte privada", () => {
  const key = lib.generateSigningKey();
  assert.equal(key.alg, "ES256");
  assert.ok(key.d && key.x && key.y && key.kid);
  const jwks = JSON.parse(lib.buildRestJwks("secreto-nuevo", [key]));
  assert.equal(jwks.keys.length, 2);
  assert.equal(jwks.keys[0].d, undefined);
  assert.deepEqual(jwks.keys[0].key_ops, ["verify"]);
  assert.equal(Buffer.from(jwks.keys[1].k, "base64url").toString(), "secreto-nuevo");
  const toml = lib.applyAuthKeyConfig("[auth]\nsite_url = \"x\"\n", { signingKeysPath: "./signing_keys.json" });
  assert.match(toml, /signing_keys_path = "\.\/signing_keys\.json"/);
});

test("upsertEnvText reemplaza y añade variables conservando el resto", () => {
  const out = lib.upsertEnvText("A=1\nB=2\n", { B: "3", C: "4" });
  assert.equal(out, "A=1\nB=3\nC=4\n");
});

test("replaceKeysInText: en documentación las claves sensibles quedan como referencia", () => {
  const oldKeys = { ANON_KEY: "OLD_ANON", SERVICE_ROLE_KEY: "OLD_SERVICE", PUBLISHABLE_KEY: "OLD_PUB", SECRET_KEY: "OLD_SECRET" };
  const newKeys = { ANON_KEY: "NEW_ANON", SERVICE_ROLE_KEY: "NEW_SERVICE", PUBLISHABLE_KEY: "NEW_PUB", SECRET_KEY: "NEW_SECRET" };
  const text = "anon: OLD_ANON\nservice: OLD_SERVICE\nsecret: OLD_SECRET\n";
  const env = lib.replaceKeysInText(text, oldKeys, newKeys);
  assert.equal(env.text, "anon: NEW_ANON\nservice: NEW_SERVICE\nsecret: NEW_SECRET\n");
  const doc = lib.replaceKeysInText(text, oldKeys, newKeys, { docMode: true });
  assert.match(doc.text, /anon: NEW_ANON/);
  assert.doesNotMatch(doc.text, /OLD_SERVICE|NEW_SERVICE|OLD_SECRET|NEW_SECRET/);
  assert.ok(lib.isDocFile("D:/x/AGENTS.md"));
  assert.ok(lib.isDocFile("D:/x/.env.example"));
  assert.ok(!lib.isDocFile("D:/x/.env.local"));
});
