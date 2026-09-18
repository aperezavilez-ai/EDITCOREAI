"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const I18N_CONFIG_PATH = path.join(os.homedir(), ".editcore", "i18n-config.json");

const TRANSLATIONS = {
  es: {
    // Configuración y Navegación
    "settings.title": "Configuración",
    "settings.general": "General",
    "settings.application": "Aplicación",
    "settings.appearance": "Apariencia",
    "settings.models": "Modelos y Proveedores",
    "settings.credits": "Créditos y Facturación",
    "settings.customizations": "Personalizaciones",
    "settings.browser": "Navegador",
    "settings.shortcuts": "Accesos Directos",
    "settings.feedback": "Enviar Comentarios",
    "settings.language": "Idioma de la Interfaz",
    "settings.language.desc": "Selecciona el idioma principal de EditCoreAI.",
    "settings.execution": "Ejecución de Agentes",
    "settings.queued_messages": "Mensajes en Cola",
    "settings.queued_messages.desc": "Configura cuándo se envían los mensajes de seguimiento.",
    "settings.send_immediately": "Enviar Inmediatamente",
    "settings.queue": "Encolar",
    "settings.security_preset": "Perfil de Seguridad",
    "settings.security_preset.desc": "Controla las acciones y permisos que el agente puede ejecutar.",
    "settings.tool_permissions": "Permisos de Herramientas",
    "settings.artifact_review": "Política de Revisión de Artefactos",
    "settings.always_proceed": "Proceder Siempre",
    "settings.network_rules": "Reglas de Acceso a Red",
    "settings.open": "Abrir",

    // Chat e IDE
    "chat.new_conversation": "Nueva Conversación",
    "chat.new_chat": "Nuevo Chat",
    "chat.history": "Historial de Conversaciones",
    "chat.scheduled_tasks": "Tareas Programadas",
    "chat.projects": "Proyectos",
    "chat.conversations": "Conversaciones",
    "chat.placeholder": "Pregunta lo que sea, usa @ para mencionar, / para acciones...",
    "chat.connect_btn": "Conectar",
    "chat.publish_btn": "Publicar",
    "chat.tools_btn": "Herramientas",

    // Créditos y Facturación
    "credits.balance": "Saldo de Créditos",
    "credits.unlimited": "Ilimitado (Admin)",
    "credits.buy_credits": "Comprar Créditos",
    "credits.recharge": "Recargar Saldo",
    "credits.redeem_code": "Canjear Código",
    "credits.depleted_title": "Saldo de Créditos Agotado",
    "credits.depleted_desc": "Has utilizado todos tus créditos disponibles. Para continuar creando y editando proyectos con la inteligencia artificial de EditCoreAI, añade más saldo a tu cuenta.",
    "credits.role_admin": "Administrador Total",
    "credits.role_user": "Usuario Estándar",

    // Shorthand keys
    "settings": "Configuración",
    "new_chat": "Nuevo Chat",
    "credits_billing": "Créditos y Facturación",
    "out_of_credits_title": "¡Créditos de IA Agotados!",
    "models": "Modelos",
    "appearance": "Apariencia",
    "application": "Aplicación",
    "general": "General",
  },
  en: {
    // Settings & Navigation
    "settings.title": "Settings",
    "settings.general": "General",
    "settings.application": "Application",
    "settings.appearance": "Appearance",
    "settings.models": "Models & Providers",
    "settings.credits": "Credits & Billing",
    "settings.customizations": "Customizations",
    "settings.browser": "Browser",
    "settings.shortcuts": "Shortcuts",
    "settings.feedback": "Provide Feedback",
    "settings.language": "Interface Language",
    "settings.language.desc": "Select the primary language for EditCoreAI.",
    "settings.execution": "Agent Execution",
    "settings.queued_messages": "Queued Messages",
    "settings.queued_messages.desc": "Configure when follow-up messages are sent.",
    "settings.send_immediately": "Send Immediately",
    "settings.queue": "Queue",
    "settings.security_preset": "Security Preset",
    "settings.security_preset.desc": "Controls the actions the agent can take.",
    "settings.tool_permissions": "Tool Permissions",
    "settings.artifact_review": "Artifact Review Policy",
    "settings.always_proceed": "Always Proceed",
    "settings.network_rules": "Network Access Rules",
    "settings.open": "Open",

    // Chat & IDE
    "chat.new_conversation": "New Conversation",
    "chat.new_chat": "New Chat",
    "chat.history": "Conversation History",
    "chat.scheduled_tasks": "Scheduled Tasks",
    "chat.projects": "Projects",
    "chat.conversations": "Conversations",
    "chat.placeholder": "Ask anything, @ to mention, / for actions...",
    "chat.connect_btn": "Connect",
    "chat.publish_btn": "Publish",
    "chat.tools_btn": "Tools",

    // Credits & Billing
    "credits.balance": "Credit Balance",
    "credits.unlimited": "Unlimited (Admin)",
    "credits.buy_credits": "Buy Credits",
    "credits.recharge": "Recharge Balance",
    "credits.redeem_code": "Redeem Code",
    "credits.depleted_title": "Credits Depleted",
    "credits.depleted_desc": "You have used all your available credits. To continue creating and editing projects with EditCoreAI, please add more balance to your account.",
    "credits.role_admin": "Full Administrator",
    "credits.role_user": "Standard User",

    // Roles & Security
    "role.admin_access": "Full Access",
    "role.user_restricted": "Projects Only",
    "role.access_denied": "Access Denied: Only the Full Administrator can modify the EditCoreAI root installation directory.",

    // Shorthand keys
    "settings": "Settings",
    "new_chat": "New Chat",
    "credits_billing": "Credits & Billing",
    "out_of_credits_title": "Credits Depleted",
    "models": "Models",
    "appearance": "Appearance",
    "application": "Application",
    "general": "General",
  },
};

class I18nManager {
  constructor(options = {}) {
    this.currentLanguage = options.defaultLanguage || "es";
    if (!options.defaultLanguage) {
      this._load();
    }
  }

  _load() {
    try {
      if (fs.existsSync(I18N_CONFIG_PATH)) {
        const raw = fs.readFileSync(I18N_CONFIG_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.language && TRANSLATIONS[parsed.language]) {
          this.currentLanguage = parsed.language;
        }
      }
    } catch {
      this.currentLanguage = "es";
    }
  }

  _save() {
    try {
      const dir = path.dirname(I18N_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(I18N_CONFIG_PATH, JSON.stringify({ language: this.currentLanguage }, null, 2), "utf8");
    } catch {
      // Non-blocking save
    }
  }

  getLanguage() {
    return this.currentLanguage;
  }

  setLanguage(lang = "es") {
    const selected = String(lang).toLowerCase();
    if (TRANSLATIONS[selected]) {
      this.currentLanguage = selected;
      this._save();
      return { ok: true, language: this.currentLanguage };
    }
    return { ok: false, error: `Idioma no soportado: ${lang}` };
  }

  t(key, fallback = null) {
    const dict = TRANSLATIONS[this.currentLanguage] || TRANSLATIONS.es;
    return dict[key] || fallback || key;
  }

  getTranslations(lang = null) {
    const target = lang || this.currentLanguage;
    return TRANSLATIONS[target] || TRANSLATIONS.es;
  }
}

const i18nInstance = new I18nManager();

module.exports = {
  I18nManager,
  i18n: i18nInstance,
  TRANSLATIONS,
};
