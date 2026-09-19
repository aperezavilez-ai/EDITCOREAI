"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

const DEFAULT_AUTH_DIR = path.join(os.homedir(), ".editcore");
const USERS_FILE_PATH = path.join(DEFAULT_AUTH_DIR, "auth-users.json");
const SESSION_FILE_PATH = path.join(DEFAULT_AUTH_DIR, "session-auth.json");

const SUPER_ADMIN_EMAIL = "aperezavilez@gmail.com";
const SUPER_ADMIN_NAME = "Alfonso Perez Avilez";

function hashPassword(password, salt) {
  if (!password) return "";
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, s, 1000, 64, "sha512").toString("hex");
  return `${s}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !password) return true; // Si no hay hash configurado, permite acceso
  const parts = storedHash.split(":");
  if (parts.length !== 2) return true;
  const [salt, origHash] = parts;
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return hash === origHash;
}

class AuthManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.storageDir = options.storageDir || DEFAULT_AUTH_DIR;
    this.usersPath = options.usersPath || path.join(this.storageDir, "auth-users.json");
    this.sessionPath = options.sessionPath || path.join(this.storageDir, "session-auth.json");
    this.users = {};
    this.activeSession = null;
    this._init();
  }

  _ensureDir() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  _init() {
    this._loadUsers();
    this._loadSession();
  }

  _loadUsers() {
    try {
      if (fs.existsSync(this.usersPath)) {
        const raw = fs.readFileSync(this.usersPath, "utf8");
        this.users = JSON.parse(raw);
      }
    } catch {
      this.users = {};
    }

    // Asegurar siempre la cuenta Super Admin
    const adminKey = SUPER_ADMIN_EMAIL.toLowerCase();
    if (!this.users[adminKey]) {
      this.users[adminKey] = {
        userId: adminKey,
        name: SUPER_ADMIN_NAME,
        email: SUPER_ADMIN_EMAIL,
        role: "admin",
        passwordHash: "", // Por defecto libre o configurable
        isSuperAdmin: true,
        createdAt: new Date().toISOString(),
      };
      this._saveUsers();
    }
  }

  _saveUsers() {
    try {
      this._ensureDir();
      fs.writeFileSync(this.usersPath, JSON.stringify(this.users, null, 2), "utf8");
    } catch (e) {
      // Fallback
    }
  }

  _loadSession() {
    try {
      if (fs.existsSync(this.sessionPath)) {
        const raw = fs.readFileSync(this.sessionPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && parsed.email) {
          const userKey = parsed.email.toLowerCase();
          const user = this.users[userKey] || {
            userId: userKey,
            name: parsed.name || (userKey === SUPER_ADMIN_EMAIL.toLowerCase() ? SUPER_ADMIN_NAME : "Usuario"),
            email: parsed.email,
            role: parsed.role || "user",
            isSuperAdmin: userKey === SUPER_ADMIN_EMAIL.toLowerCase(),
          };
          this.activeSession = {
            token: parsed.token || crypto.randomUUID(),
            user: {
              name: user.name,
              email: user.email,
              role: user.role,
              isSuperAdmin: Boolean(user.isSuperAdmin || user.role === "admin"),
            },
            rememberMe: Boolean(parsed.rememberMe),
            createdAt: parsed.createdAt || new Date().toISOString(),
          };
          return;
        }
      }
    } catch {
      this.activeSession = null;
    }

    // Sesión por defecto automática para el Super Admin si no hay sesión explícita
    this.activeSession = {
      token: crypto.randomUUID(),
      user: {
        name: SUPER_ADMIN_NAME,
        email: SUPER_ADMIN_EMAIL,
        role: "admin",
        isSuperAdmin: true,
      },
      rememberMe: true,
      createdAt: new Date().toISOString(),
    };
    this._saveSession();
  }

  _saveSession() {
    try {
      this._ensureDir();
      if (this.activeSession && this.activeSession.rememberMe) {
        fs.writeFileSync(this.sessionPath, JSON.stringify(this.activeSession, null, 2), "utf8");
      } else {
        if (fs.existsSync(this.sessionPath)) {
          fs.unlinkSync(this.sessionPath);
        }
      }
    } catch {
      // Ignore
    }
  }

  register({ name, email, password, role = "developer" }) {
    if (!email || !email.includes("@")) {
      throw new Error("El correo electrónico es inválido.");
    }
    const cleanEmail = email.trim().toLowerCase();
    if (this.users[cleanEmail]) {
      throw new Error("Ya existe una cuenta con este correo electrónico.");
    }

    const cleanName = (name || cleanEmail.split("@")[0]).trim();
    const cleanRole = role === "admin" ? "admin" : (role === "auditor" ? "auditor" : "developer");
    const passwordHash = password ? hashPassword(password) : "";

    const newUser = {
      userId: cleanEmail,
      name: cleanName,
      email: cleanEmail,
      role: cleanRole,
      passwordHash,
      isSuperAdmin: cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase(),
      createdAt: new Date().toISOString(),
    };

    this.users[cleanEmail] = newUser;
    this._saveUsers();

    return this.login({ email: cleanEmail, password, rememberMe: true });
  }

  login({ email, password, rememberMe = true }) {
    if (!email) {
      throw new Error("Se requiere un correo electrónico.");
    }
    const cleanEmail = email.trim().toLowerCase();
    let user = this.users[cleanEmail];

    // Si es Super Admin o primer inicio
    if (!user) {
      if (cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
        user = {
          userId: cleanEmail,
          name: SUPER_ADMIN_NAME,
          email: SUPER_ADMIN_EMAIL,
          role: "admin",
          passwordHash: "",
          isSuperAdmin: true,
          createdAt: new Date().toISOString(),
        };
        this.users[cleanEmail] = user;
        this._saveUsers();
      } else {
        // Auto-registro para desarrollo fluido
        user = {
          userId: cleanEmail,
          name: cleanEmail.split("@")[0],
          email: cleanEmail,
          role: "developer",
          passwordHash: password ? hashPassword(password) : "",
          isSuperAdmin: false,
          createdAt: new Date().toISOString(),
        };
        this.users[cleanEmail] = user;
        this._saveUsers();
      }
    } else {
      if (user.passwordHash && password && !verifyPassword(password, user.passwordHash)) {
        throw new Error("Contraseña incorrecta.");
      }
    }

    this.activeSession = {
      token: crypto.randomUUID(),
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        isSuperAdmin: Boolean(user.isSuperAdmin || user.role === "admin"),
      },
      rememberMe: Boolean(rememberMe),
      createdAt: new Date().toISOString(),
    };

    this._saveSession();
    this.emit("session-changed", this.activeSession);

    return {
      success: true,
      session: this.activeSession,
    };
  }

  logout() {
    this.activeSession = null;
    try {
      if (fs.existsSync(this.sessionPath)) {
        fs.unlinkSync(this.sessionPath);
      }
    } catch {}

    this.emit("session-changed", null);
    return { success: true };
  }

  getCurrentSession() {
    return {
      isAuthenticated: Boolean(this.activeSession),
      session: this.activeSession,
      user: this.activeSession?.user || null,
    };
  }

  updateProfile({ name, email, role }) {
    if (!this.activeSession || !this.activeSession.user) {
      throw new Error("No hay sesión activa.");
    }
    const curEmail = this.activeSession.user.email.toLowerCase();
    const user = this.users[curEmail];
    if (user) {
      if (name) user.name = name.trim();
      if (role) user.role = role;
      this._saveUsers();
    }
    if (name) this.activeSession.user.name = name.trim();
    if (role) this.activeSession.user.role = role;
    this._saveSession();
    this.emit("session-changed", this.activeSession);
    return { success: true, user: this.activeSession.user };
  }
}

const authManagerInstance = new AuthManager();

module.exports = {
  AuthManager,
  authManager: authManagerInstance,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_NAME,
};
