"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { CreditLedger } = require("../runtime/credit-ledger");

test("CreditLedger: Admin has infinite balance and never depletes", () => {
  const tmpFile = path.join(os.tmpdir(), `credits-test-${Date.now()}-1.json`);
  const ledger = new CreditLedger({ storagePath: tmpFile, defaultCredits: 100 });

  const admin = ledger.getUser("admin");
  assert.equal(admin.role, "admin");
  assert.equal(admin.balance, Infinity);
  assert.equal(admin.isSuperAdmin, true);

  const deductRes = ledger.deductCredits("admin", 50, "Test query");
  assert.equal(deductRes.success, true);
  assert.equal(deductRes.balance, Infinity);

  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
});

test("CreditLedger: Super admin Alfonso Perez Avilez auto-detected", () => {
  const tmpFile = path.join(os.tmpdir(), `credits-test-${Date.now()}-2.json`);
  const ledger = new CreditLedger({ storagePath: tmpFile, defaultCredits: 100 });

  const user = ledger.getUser("aperezavilez@gmail.com");
  assert.equal(user.role, "admin");
  assert.equal(user.balance, Infinity);

  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
});

test("CreditLedger: Normal user deducts credits and locks at 0", () => {
  const tmpFile = path.join(os.tmpdir(), `credits-test-${Date.now()}-3.json`);
  const ledger = new CreditLedger({ storagePath: tmpFile, defaultCredits: 10 });

  const user = ledger.getUser("normal_user_1");
  assert.equal(user.role, "user");
  assert.equal(user.balance, 10);

  // Deduct 5
  const res1 = ledger.deductCredits("normal_user_1", 5, "Task 1");
  assert.equal(res1.success, true);
  assert.equal(res1.balance, 5);

  // Deduct 5 -> 0
  const res2 = ledger.deductCredits("normal_user_1", 5, "Task 2");
  assert.equal(res2.success, true);
  assert.equal(res2.balance, 0);

  // Deduct 1 -> Fail OUT_OF_CREDITS
  const res3 = ledger.deductCredits("normal_user_1", 1, "Task 3");
  assert.equal(res3.success, false);
  assert.equal(res3.code, "OUT_OF_CREDITS");

  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
});

test("CreditLedger: Redeem voucher code adds credits", () => {
  const tmpFile = path.join(os.tmpdir(), `credits-test-${Date.now()}-4.json`);
  const ledger = new CreditLedger({ storagePath: tmpFile, defaultCredits: 0 });

  const res1 = ledger.redeemCode("test_user", "EDITCORE100");
  assert.equal(res1.success, true);
  assert.equal(res1.balance, 100);

  // Cannot redeem same code twice
  const res2 = ledger.redeemCode("test_user", "EDITCORE100");
  assert.equal(res2.success, false);

  // Redeem promo code (100 + 250 = 350)
  const res3 = ledger.redeemCode("test_user", "PROMO2026");
  assert.equal(res3.success, true);
  assert.equal(res3.balance, 350);

  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
});
