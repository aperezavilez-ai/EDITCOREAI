"use strict";

/**
 * Cloud Collaboration Channel — sincronización cifrada punto a punto.
 * - Estado de workspace, telemetría de enjambre y parches validados.
 * - Cifrado AES-256-GCM + HMAC para integridad.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");

const ALGO = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const HMAC_ALGO = "sha256";

class CloudCollabChannel {
  constructor(options = {}) {
    this.peerId = options.peerId || this._generatePeerId();
    this.sharedKey = options.sharedKey || this._deriveKey(options.passphrase || "");
    this.outboxDir = String(options.outboxDir || path.join(process.cwd(), ".editcore", "cloud-outbox")).replace(/\\/g, "/");
    this.inboxDir = String(options.inboxDir || path.join(process.cwd(), ".editcore", "cloud-inbox")).replace(/\\/g, "/");
    this.trustedPeers = new Set(Array.isArray(options.trustedPeers) ? options.trustedPeers : []);
    fs.mkdirSync(this.outboxDir, { recursive: true });
    fs.mkdirSync(this.inboxDir, { recursive: true });
  }

  async publishState(payload) {
    const envelope = this._seal(payload);
    const fileName = `${Date.now().toString(36)}_${this.peerId}.json`;
    const target = path.join(this.outboxDir, fileName);
    fs.writeFileSync(target, JSON.stringify(envelope), "utf8");
    return { ok: true, target, peerId: this.peerId };
  }

  async syncInbox() {
    const files = fs.readdirSync(this.inboxDir).filter((f) => f.endsWith(".json"));
    const accepted = [];
    for (const file of files) {
      const full = path.join(this.inboxDir, file);
      try {
        const raw = JSON.parse(fs.readFileSync(full, "utf8"));
        const payload = this._open(raw);
        if (!payload) continue;
        accepted.push({ file, peerId: payload.peerId, receivedAt: new Date().toISOString() });
        fs.unlinkSync(full);
      } catch {
        // skip invalid
      }
    }
    return { ok: true, accepted: accepted.length, items: accepted };
  }

  _seal(payload) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGO, this.sharedKey, iv);
    const plaintext = Buffer.from(JSON.stringify({ peerId: this.peerId, payload, ts: Date.now() }), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const hmac = crypto.createHmac(HMAC_ALGO, this.sharedKey).update(Buffer.concat([iv, encrypted, authTag])).digest("hex");
    return { iv: iv.toString("hex"), data: encrypted.toString("hex"), authTag: authTag.toString("hex"), hmac };
  }

  _open(envelope) {
    const iv = Buffer.from(envelope.iv || "", "hex");
    const data = Buffer.from(envelope.data || "", "hex");
    const authTag = Buffer.from(envelope.authTag || "", "hex");
    const expectedHmac = envelope.hmac || "";
    const computed = crypto.createHmac(HMAC_ALGO, this.sharedKey).update(Buffer.concat([iv, data, authTag])).digest("hex");
    if (expectedHmac !== computed) return null;
    const decipher = crypto.createDecipheriv(ALGO, this.sharedKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  }

  _deriveKey(passphrase) {
    const salt = crypto.createHash("sha256").update(String(passphrase)).digest();
    return crypto.pbkdf2Sync(String(passphrase || ""), salt, 100_000, KEY_LENGTH, "sha256");
  }

  _generatePeerId() {
    return crypto.randomBytes(8).toString("hex");
  }
}

module.exports = { CloudCollabChannel };
