# MAPA del paquete v5.2.0

Conteos por la regla del último byte: `(Get-Content).Count` en Windows =
saltos de línea si el archivo termina en salto; saltos + 1 si no termina.

| Archivo | Count | Qué cambia |
|---|---:|---|
| editcore-chat-kernel/orchestrator.js | 5247 (sin salto final) | Fuera la inyección de la guía (:3344) y el empujón forzado con su detector (:4186/:1950); notas [EDITCORE-V520] |
| editcore-chat-kernel/self-knowledge.js | 66 | Guía, detector y regex eliminados; doctrina Supabase corregida a Cloud oficial; etiqueta del checklist sin «propio / GAFCORE» |
| editcore-chat-kernel/extra-tools.js | 272 | Descripción de check_connections sin «SIEMPRE» ni «Supabase/GAFCORE»; fuera el siguiente-paso publish_project; fuera la fila/servicio Supabase propio |
| test/compuerta-conexiones-v520.test.js | 213 | Batería nueva (5 casos) |
| test/agent-network-memory.test.js | 174 | Re-delimitación declarada (la guía ya no existe); afirmaciones del set intactas |
| web-portal/js/web-agent.js | 609 | Compuerta espejo de la web eliminada; textos de conexiones corregidos |
| web-portal/js/web-connections.js | 274 | Textos de la superficie web corregidos (Supabase oficial) |
| package.json | 152 | Versión 5.2.0 |
| package-lock.json | 11270 | Versión 5.2.0 (solo líneas 3 y 9) |
| EDITCORE-MANIFEST.md | 74 (sin salto final) | Versión 5.2.0 y textos |
| scripts/EditCoreAiRootLauncher.cs | 172 | 5.2.0.0 |
| LEEME-v520.md | — | Este paquete |
| MAPA-v520.md | — | Este mapa |

Sin cambios (verificación de no-regresión): tools.js 2407 ·
thread-memory.js 956 · thread-core.js 548 · agent-token-harness.js 664 ·
correcciones-v518.test.js 373 · costo-tarea-v519.test.js 471.
