"use strict";

const path = require("node:path");

/**
 * Guardián de seguridad y control de acceso basado en roles (RBAC).
 * Protege la carpeta raíz de EditCoreAI para que solo el Administrador Total tenga acceso de modificación.
 */
class RolePolicyGuard {
  constructor(options = {}) {
    this.coreRoot = path.resolve(options.editcoreRoot || options.coreRoot || process.cwd());
  }

  /**
   * Verifica si un usuario tiene permiso para acceder o modificar una ruta específica.
   * El rol debe venir del servidor de cuentas (nunca del correo ni del renderer).
   */
  canAccessPath(user = {}, targetPath = "", operation = "read") {
    const role = user.role === "admin" ? "admin" : "user";

    // Administrador Total tiene acceso absoluto e irrestricto
    if (role === "admin") {
      return { allowed: true, role: "admin", reason: "ADMIN_FULL_ACCESS" };
    }

    // Usuario Estándar: Verificar si la ruta solicitada está dentro del core de EditCoreAI
    if (!targetPath) {
      return { allowed: true, role: "user" };
    }

    const resolvedTarget = path.resolve(targetPath);
    const isInsideCore = resolvedTarget === this.coreRoot || resolvedTarget.startsWith(this.coreRoot + path.sep);

    if (isInsideCore) {
      return {
        allowed: false,
        role: "user",
        code: "ACCESS_DENIED_ROOT_PROTECTION",
        error: "ACCESS_DENIED_CORE_ROOT",
        message: "Acceso denegado: Solo el Administrador Total tiene permisos para inspeccionar o modificar la carpeta raíz de EditCoreAI. Los usuarios estándar solo pueden trabajar en sus propios proyectos.",
      };
    }

    return { allowed: true, role: "user" };
  }

  checkAccess(user = {}, targetPath = "", operation = "read") {
    return this.canAccessPath(user, targetPath, operation);
  }

  /**
   * Sanitiza las opciones de apertura de proyecto según el rol del usuario.
   */
  validateProjectAccess(user = {}, projectPath = "") {
    return this.canAccessPath(user, projectPath);
  }
}

const rolePolicyGuardInstance = new RolePolicyGuard();

module.exports = {
  RolePolicyGuard,
  rolePolicyGuard: rolePolicyGuardInstance,
};
