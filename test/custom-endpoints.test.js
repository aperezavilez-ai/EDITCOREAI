"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const PRIMARY_PROVIDER_KEYS = ["openai", "anthropic", "gemini", "meai", "apicredits"];

function mergeGatewaySecureState(secureState) {
  const storedProfiles = Array.isArray(secureState["editcore-provider-profiles"])
    ? secureState["editcore-provider-profiles"]
    : [];
  const gatewayProfiles = storedProfiles.filter((profile) => profile?.providerKey === "custom:gafcore-gateway"
    && profile?.apiKey && profile?.baseUrl && profile?.model
    && String(profile.baseUrl).toLowerCase().includes("gafcore-gateway.vercel.app"));
  const userCustomProfiles = storedProfiles.filter((profile) => profile?.providerKey?.startsWith("custom:")
    && profile.providerKey !== "custom:gafcore-gateway");
  const userCustomProviders = (secureState["editcore-custom-providers"] || [])
    .filter((provider) => provider?.id && provider.id !== "gafcore-gateway");
  if (!gatewayProfiles.length) return secureState;
  const next = { ...secureState };
  next["editcore-provider-profiles"] = [...gatewayProfiles, ...userCustomProfiles];
  next["editcore-providers"] = {};
  const gafcoreProvider = (secureState["editcore-custom-providers"] || []).find((provider) => provider?.id === "gafcore-gateway");
  next["editcore-custom-providers"] = [
    ...(gafcoreProvider ? [gafcoreProvider] : []),
    ...userCustomProviders,
  ];
  return next;
}

test("initializeSecureState conserva endpoints personalizados con gateway activo", () => {
  const secureState = {
    "editcore-provider-profiles": [
      { id: "gw1", providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-4.6", apiKey: "k", baseUrl: "https://gafcore-gateway.vercel.app/api/openai/v1", status: "active" },
      { id: "c1", providerKey: "custom:my-api", model: "gpt-4o-mini", apiKey: "k2", baseUrl: "https://api.example.com/v1", status: "active" },
      { id: "o1", providerKey: "openai", model: "gpt-4o", apiKey: "k3", status: "active" },
    ],
    "editcore-custom-providers": [
      { id: "gafcore-gateway", name: "GafCore Gateway", baseUrl: "https://gafcore-gateway.vercel.app/api/openai/v1" },
      { id: "my-api", name: "Mi API", baseUrl: "https://api.example.com/v1" },
    ],
    "editcore-providers": { openai: { baseUrl: "https://api.openai.com/v1" } },
  };
  const merged = mergeGatewaySecureState(secureState);
  assert.equal(merged["editcore-provider-profiles"].length, 2);
  assert.ok(merged["editcore-provider-profiles"].some((profile) => profile.id === "c1"));
  assert.ok(!merged["editcore-provider-profiles"].some((profile) => PRIMARY_PROVIDER_KEYS.includes(profile.providerKey)));
  assert.equal(merged["editcore-custom-providers"].length, 2);
  assert.ok(merged["editcore-custom-providers"].some((provider) => provider.id === "my-api"));
});
