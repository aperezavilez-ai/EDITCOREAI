"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { CreditLedger, usageMeter } = require("../runtime/credit-ledger");
const { AuthError } = require("../runtime/auth-manager");

function fakeAuth(handlers = {}, { authenticated = true } = {}) {
  const calls = [];
  return {
    calls,
    account: null,
    isAuthenticated: () => authenticated,
    refreshAccount: async () => {
      if (handlers.refreshAccount) return handlers.refreshAccount();
      return { email: "ana@gmail.com", role: "user", status: "active", credits_balance: 5, is_unlimited: false };
    },
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (!handlers[fn]) throw new AuthError("SERVER", "sin respuesta");
      return handlers[fn](args);
    },
  };
}

const account = (extra = {}) => ({ email: "ana@gmail.com", role: "user", status: "active", credits_balance: 5, is_unlimited: false, ...extra });

test("Consultar sin sesión se bloquea", async () => {
  const ledger = new CreditLedger({ auth: fakeAuth({}, { authenticated: false }) });
  const res = await ledger.checkCanRun();
  assert.equal(res.ok, false);
  assert.equal(res.code, "NO_SESSION");
});

test("Con saldo se permite consultar y el cliente nunca se descuenta solo", async () => {
  const auth = fakeAuth();
  const ledger = new CreditLedger({ auth });
  const res = await ledger.checkCanRun();
  assert.equal(res.ok, true);
  assert.equal(res.balance, 5);
  assert.equal(auth.calls.some((c) => c.fn === "editcoreai_consume_credits"), false);
});

test("Sin saldo o con cuenta suspendida no se ejecuta", async () => {
  const out = new CreditLedger({ auth: fakeAuth({ refreshAccount: () => account({ credits_balance: 0, topup_base: 20 }) }) });
  const r1 = await out.checkCanRun();
  assert.equal(r1.ok, false);
  assert.equal(r1.code, "OUT_OF_CREDITS");
  assert.match(r1.error, /saldo/);
  assert.equal(r1.canExecute, false);
  assert.equal(r1.usedPercent, 100);

  const susp = new CreditLedger({ auth: fakeAuth({ refreshAccount: () => account({ status: "suspended" }) }) });
  const r2 = await susp.checkCanRun();
  assert.equal(r2.ok, false);
  assert.equal(r2.code, "ACCOUNT_SUSPENDED");
});

test("La barra de uso se calcula desde la última recarga", () => {
  assert.deepEqual(usageMeter({ credits_balance: 15, topup_base: 20 }), { balance: 15, topupBase: 20, used: 5, usedPercent: 25 });
  assert.equal(usageMeter({ credits_balance: 0, topup_base: 0 }).usedPercent, 100);
  assert.equal(usageMeter({ credits_balance: 30, topup_base: 20 }).usedPercent, 0);
});

test("Si el servidor no responde nunca hay saldo infinito", async () => {
  const ledger = new CreditLedger({ auth: fakeAuth({ refreshAccount: () => { throw new AuthError("NETWORK"); } }) });
  const bal = await ledger.getBalance();
  assert.equal(bal.ok, false);
  assert.equal(bal.canExecute, false);
  assert.equal(bal.isUnlimited, false);
  assert.notEqual(bal.balance, Infinity);

  const check = await ledger.checkCanRun();
  assert.equal(check.ok, false);
  assert.equal(check.canExecute, false);
});

test("El saldo y el rol vienen del servidor", async () => {
  const ledger = new CreditLedger({ auth: fakeAuth({ refreshAccount: () => account({ role: "admin", credits_balance: 0 }) }) });
  const bal = await ledger.getBalance();
  assert.equal(bal.role, "admin");
  assert.equal(bal.isUnlimited, true);
  assert.equal(bal.canExecute, true);

  const user = new CreditLedger({ auth: fakeAuth({ refreshAccount: () => account({ credits_balance: 0 }) }) });
  assert.equal((await user.getBalance()).canExecute, false);
});

test("Canjear un código lo valida el servidor", async () => {
  const auth = fakeAuth({
    editcoreai_redeem_voucher: ({ p_code }) => (p_code === "A1B2C3D4E5F6A7B8C9D0"
      ? { ok: true, credits_added: 100, account: account({ credits_balance: 105 }) }
      : { ok: false, error: "INVALID_CODE" }),
  });
  const ledger = new CreditLedger({ auth });
  const ok = await ledger.redeemVoucher(" A1B2C3D4E5F6A7B8C9D0 ");
  assert.equal(ok.success, true);
  assert.equal(ok.balance, 105);
  const bad = await ledger.redeemVoucher("ADMINVIP");
  assert.equal(bad.success, false);
  assert.equal(bad.code, "INVALID_CODE");
  assert.equal((await ledger.redeemVoucher("  ")).code, "INVALID_CODE");
});

test("Las funciones de administración pasan por el servidor y respetan FORBIDDEN", async () => {
  const auth = fakeAuth({
    editcoreai_admin_create_voucher: () => { throw new AuthError("FORBIDDEN"); },
    editcoreai_admin_grant_credits: (args) => ({ ok: true, account: account({ email: args.p_email, credits_balance: 50 }) }),
  });
  const ledger = new CreditLedger({ auth });
  const denied = await ledger.adminCreateVoucher({ credits: 100 });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "FORBIDDEN");
  assert.match(denied.error, /administrador/);

  const granted = await ledger.adminGrantCredits({ email: "luis@gmail.com", amount: 50 });
  assert.equal(granted.ok, true);
  assert.equal(granted.account.credits_balance, 50);
});

test("Crear código manda vigencia y usos correctos", async () => {
  const auth = fakeAuth({ editcoreai_admin_create_voucher: (args) => ({ ok: true, code: "ABCDEF0123456789ABCD", credits: args.p_credits }) });
  const ledger = new CreditLedger({ auth });
  const res = await ledger.adminCreateVoucher({ credits: 200, maxUses: 3, expiresInDays: 7, note: "promo" });
  assert.equal(res.ok, true);
  const args = auth.calls[0].args;
  assert.equal(args.p_credits, 200);
  assert.equal(args.p_max_uses, 3);
  assert.ok(Date.parse(args.p_expires_at) > Date.now() + 6 * 86400000);
  assert.equal(args.p_code, null);
});

test("La tarifa por tokens se conserva", () => {
  const ledger = new CreditLedger({ auth: fakeAuth() });
  const r = ledger.calculateUsageCredits("claude-sonnet-4-6", 1_000_000, 0);
  assert.equal(r.totalCostUsd, 3);
  assert.equal(r.credits, 90);
});
