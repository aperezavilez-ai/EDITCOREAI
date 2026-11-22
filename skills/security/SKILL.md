---
name: security
description: Especialista en ciberseguridad, mitigación OWASP Top 10, sanitización estricta de entradas, auditoría de comandos y prevención de fugas de secretos.
triggers:
  - security
  - auth
  - token
  - jwt
  - sanitize
  - owasp
  - vulnerability
  - audit
---

# Habilidad Modular: Security & Defensive Architecture

## Principios de Diseño
- Defensa en profundidad: validación de entrada en la frontera, autorización basada en roles/recursos (RBAC/ABAC) y cifrado en tránsito y en reposo.
- Principio de mínimo privilegio: tokens con expiración corta, scopes mínimos y credenciales separadas del código en variables de entorno protegidas.
- Bloqueo proactivo de comandos peligrosos: interceptación de operaciones destructivas o exfiltración de red no autorizada.

## Reglas de Implementación
1. Toda entrada de usuario no confiable debe validarse con esquemas rígidos (Zod, Pydantic, Joi) antes de ser procesada.
2. Cabeceras HTTP de seguridad obligatorias: CSP, HSTS, X-Content-Type-Options y CORS restrictivo.
3. Cero secretos en repositorio: verificación con escaneo estático y ofuscación en logs de auditoría.
