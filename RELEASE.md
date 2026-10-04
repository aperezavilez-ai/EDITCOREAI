# RELEASE v4.3.0

## Saldo global de ME AI en Administración y cobro con el costo real

### Nuevo
- **Saldo global de ME AI** en Administración: cuánto queda en el panel de ME AI y cuánto vale en dinero real (calculado con lo que pagas en yuanes y el tipo de cambio del día), barra de gastado sobre el límite, cuántos días alcanza al ritmo de los últimos 7 días y alerta cuando queda poco.
- **Consumo separado**: por hoy, 7 y 30 días se ve cuánto bajó el saldo de ME AI, cuánto gastaron los usuarios, cuánto el administrador, cuánto se cobró a los usuarios y la ganancia.
- **Tabla de precios por modelo**: precio del panel, costo real y lo que paga el usuario.
- Cada usuario de la lista muestra su consumo de los últimos 30 días.
- **Registrar compra**: eliges el paquete (¥500 → 21,000, ¥200 → 8,000…), se toma el tipo de cambio del día y ves al momento cuánto te cuesta cada dólar de panel. Historial de compras con opción de borrar.
- **Ajustes**: margen de ganancia y corrección del saldo si no coincide con ME AI.
- Panel de saldo rediseñado: más claro y profesional.

### Corregido
- El cobro a usuarios ahora usa el costo real de ME AI multiplicado por el margen (2, editable en «Ajustes»). Antes se calculaba con los dólares del panel como si fueran dólares reales.
- **Navegador interno sin errores falsos de `.next`**: EditCoreAI borraba la caché `.next` de los proyectos Next.js (y corría `next build`) mientras el servidor del proyecto estaba corriendo, lo que provocaba los errores «ENOENT … .next\cache\webpack … pack.gz». Ya nunca toca `.next` con el servidor encendido, y los avisos internos de caché de webpack ya no aparecen en «Errores del preview». Los errores reales del proyecto se siguen mostrando.

### Build
- `EDITCOREAI.exe` (4.3.0.0) y `release/EDITCOREAI-Setup.exe` (4.3.0), construidos desde un árbol limpio en el commit publicado.

---

# RELEASE v4.2.9

## ME AI con una sola API, Publicar inteligente y engrane en el IDE

### Nuevo
- **ME AI con una sola API**: todos los modelos usan la clave de Claude Sonnet 4.6 (verificada: los 7 modelos responden). En Modelos ya no hay una clave por modelo y en el chat eliges «Auto» o un modelo de ME AI. APICredits queda oculto.
- **Publicar**: gris mientras el proyecto no está conectado y azul cuando ya lo está; al pulsarlo sube los cambios a GitHub, Vercel y Supabase. El botón «Conectar» se quitó: para conectar un proyecto, pídelo en el chat («conecta este proyecto con GitHub, Vercel y Supabase»).
- **Engrane ⚙ en el IDE**: el usuario ve su saldo y consumo, y el administrador abre Administración, sin salir del IDE.
- **Conexiones por usuario**: cada usuario conecta sus propias cuentas; nunca ve las del administrador.

### Corregido
- El botón «Conectar» fallaba con un error interno (ya no existe y el error está corregido).
- En el modo chat no se veía la barra de abajo.
- El navegador interno mostraba avisos del proyecto como «Errores del preview»; ahora solo muestra errores reales.
- Incluye lo de 4.2.8: «Ver como usuario» se cierra con «✕ Salir de vista usuario» o Esc.

### Build
- `EDITCOREAI.exe` (4.2.9.0) y `release/EDITCOREAI-Setup.exe` (4.2.9), construidos desde un árbol limpio en el commit publicado.

---

# RELEASE v4.2.8

## La vista «Ver como usuario» ya se puede cerrar

### Corregido
- La franja naranja de «Ver como usuario» tapaba los botones y no se podía cerrar. Se quitó: ahora aparece el botón «✕ Salir de vista usuario» en la barra superior (vista de proyectos) y en la barra lateral del chat, y la tecla Esc también vuelve a administrador. Una línea naranja delgada arriba indica que estás en la vista de usuario.
- Se quitaron del código y de las guías del agente las referencias a marcas de terceros.

### Build
- `EDITCOREAI.exe` (4.2.8.0) y `release/EDITCOREAI-Setup.exe` (4.2.8), construidos desde un árbol limpio en el commit publicado.

---

# RELEASE v4.2.7

## Administración desde la app oficial, pagos con Mercado Pago y actividad de usuarios

### Nuevo
- Botones «Administración» y «Ver como usuario» (solo el administrador), también en la barra de la vista de proyectos.
- «Ver como usuario»: muestra EditCoreAI exactamente como lo ve un cliente (sin proveedores, saldo de ejemplo), con una franja para volver a administrador.
- Recargas con Mercado Pago: el cliente paga con el link oficial y el administrador ve los pagos y ajusta precio, crédito y link desde el panel. Con el token de Mercado Pago configurado, el saldo se acredita solo.
- Actividad de usuarios en el panel: quién está usando EditCoreAI ahora, cuándo la abrió por última vez y con qué versión.
- Descarga oficial desde www.editcore.mx/download (siempre la versión más nueva).

### Build
- `EDITCOREAI.exe` (4.2.7.0) y `release/EDITCOREAI-Setup.exe` (4.2.7), construidos desde un árbol limpio en el commit publicado.

---

# RELEASE v4.2.6

## EditCoreAI multiusuario: cuentas con Google y saldo prepago

### Nuevo
- Entrada obligatoria con Google. Las cuentas, el rol y el saldo viven en el servidor propio de EditCoreAI; la app no puede cambiarlos.
- Saldo prepago: cada usuario recarga saldo (pago manual del administrador o código de recarga) y se va descontando según los tokens que usa la IA. Barra de consumo en el chat y en Ajustes → Saldo y uso. Sin saldo, la IA se bloquea hasta recargar.
- Los usuarios solo ven los modelos para elegir (o Auto). No ven proveedores, ni sus nombres, ni el panel de configuración. El administrador tiene acceso total y uso ilimitado.
- Panel de administración: saldo de los usuarios, cobrado hoy, costo y margen, códigos de recarga y ajustes de saldo.

### Seguridad
- Las claves de fábrica del servidor de cuentas se cambiaron por claves propias. Hay que volver a entrar con Google una vez.
- La clave del proveedor de IA vive solo en el servidor; la app de los usuarios nunca la recibe.

### Build
- `EDITCOREAI.exe` (4.2.6.0) y `release/EDITCOREAI-Setup.exe` (4.2.6), construidos desde un árbol limpio en el commit publicado.

---

# RELEASE v4.2.5

## Sin avisos falsos de "no se basa en lecturas del disco"

### Corregido
- El reporte de análisis mostraba "Este análisis no se basa en lecturas del disco" aunque EditCore sí había leído los archivos de la evidencia. El aviso solo contaba las lecturas que hacía el modelo; ahora cuenta también las del analista y solo aparece si de verdad no se leyó nada.

### Build
- `EDITCOREAI.exe` (4.2.5.0) y `release/EDITCOREAI-Setup.exe` (4.2.5), construidos desde un árbol limpio en el commit publicado.

---

# RELEASE v4.2.4

## Reporte de análisis sin secciones duplicadas

### Corregido
- La tabla "Chequeos reales ejecutados" y las listas de errores y advertencias verificados aparecen una sola vez, arriba del reporte. El modelo ya no las copia al final y, si lo hiciera, EditCore las quita.
- El reporte ya no dice que los tests "no se ejecutaron" cuando el análisis sí los corrió.

### Build
- `EDITCOREAI.exe` (4.2.4.0) y `release/EDITCOREAI-Setup.exe` (4.2.4), construidos desde un árbol limpio en el commit publicado.

---

# RELEASE v4.2.3

## Análisis sin falsos errores, caché del proveedor completa y puntos del árbol

### Corregido
- El análisis ya no reporta como errores imports opcionales protegidos (playwright) ni líneas de documentación que listan archivos eliminados. En EditCoreAI pasa de 12 avisos a 0.
- Si el análisis corrió los tests, el informe muestra el resultado real en lugar de "No ejecutado".
- Rutas desactualizadas en AGENTS.md y ARQUITECTURA-SISTEMA.md.
- Los puntos del árbol de archivos vuelven a marcar lo que toca el agente: archivos con hallazgos del análisis y archivos que escribe una corrección.

### Tokens y caché
- La caché del proveedor ahora cubre todo el bucle de herramientas (antes solo el prompt de sistema y el primer mensaje): cada llamada lee de caché el contexto ya enviado.
- La línea de uso bajo cada respuesta muestra caché leída y escrita (antes siempre 0 por nombres de campo distintos).

### Build
- `EDITCOREAI.exe` (4.2.3.0) y `release/EDITCOREAI-Setup.exe` (4.2.3), construidos desde un árbol limpio en el commit publicado.

---

# RELEASE v4.2.2

## Reintentos de listado de archivos que funcionan

### Corregido
- La estrategia "glob" de reintentos de `list_files` (`runtime/smart-retry.js`) fallaba siempre: usaba la API con callback del paquete `glob`, que en la versión instalada (v13) ya no existe. Ahora usa `fs.promises.glob` nativo de Node, excluye `node_modules`, `.git`, `dist` y `build`, y no agrega dependencias.

### Build
- `EDITCOREAI.exe` (4.2.2.0) y `release/EDITCOREAI-Setup.exe` (4.2.2), construidos desde un árbol limpio en el commit publicado.

---

# RELEASE v4.2.1

## El chat ya no puede dejar EditCoreAI sin abrir

### Corregido
- Cuando el proyecto abierto en el chat es el propio EditCoreAI, el agente podía editar su código y dejar el arranque roto (por ejemplo, un `require` a un archivo que no existe): el EXE dejaba de abrir.
- Ahora, al terminar cada turno que modificó la carpeta de la app, EditCoreAI verifica que `main.js`, `preload.js` y el núcleo del chat cargan (sintaxis y cada `require` de nivel superior). Si algo falla, deshace solo los cambios de ese turno, borra los archivos que creó y lo explica en el chat.
- Los cambios legítimos en varios pasos (agregar un `require` y después crear el archivo) no se revierten: la verificación se hace al final del turno.

### Build
- `EDITCOREAI.exe` (4.2.1.0) y `release/EDITCOREAI-Setup.exe` (4.2.1), construidos desde un árbol limpio en el commit publicado.

---

# RELEASE v4.2.0

## Métricas reales de uso y caché del chat

### Corregido
- El chat devolvía siempre el uso de tokens en cero: se inicializaba y nunca se sumaba. Ahora suma entrada, salida, total y tokens de caché (lectura y escritura) de cada turno del modelo.
- Los tokens de caché se reconocen en más formatos de proveedor (`cached_tokens`, `cache_write_input_tokens`, `cache_creation.input_tokens`).

### Versionado
- Cada parte de la versión va de 0 a 9: después de 4.1.9 sigue 4.2.0. Nuevo gate de pre-empaquetado que lo verifica y comprueba que la versión coincide en `package.json`, `package-lock.json`, `EDITCORE-MANIFEST.md` y el lanzador.

### Build
- `EDITCOREAI.exe` (4.2.0.0) y `release/EDITCOREAI-Setup.exe` (4.2.0), construidos desde un árbol limpio en el commit publicado.

---

# RELEASE v4.1.9

## Limpieza total, instalador que arranca y sin secretos dentro del paquete

### Corregido
- El instalador v4.1.8 no arrancaba: `main.js` cargaba `./scripts/failsafe-recovery` al inicio y el empaquetado excluye `scripts/`. Nuevo gate de pre-empaquetado que bloquea cualquier carga al arranque de una carpeta excluida.
- Los instaladores anteriores incluían `.env.local` y `.claude/settings.local.json` dentro de `app.asar`. Ahora el empaquetado excluye `.env*`, `.env.local`, `.claude/` y `release/`, con un gate que lo verifica. Los instaladores anteriores se retiraron de GitHub Releases.

### Limpieza (607 archivos sin uso)
- `agent-core/` (no lo cargaba nada), `editcore-chat-kernel/skills/` (copias de `brain-seed/skills`), módulos de `runtime/` nunca conectados o cargados sin usar, subagentes y paneles HTML huérfanos, y tests que solo probaban ese código.
- `resources/ui-overlay/` completo: copia que el instalador incluía pero nunca ejecutaba. El código vive solo en la raíz.

### Build
- `EDITCOREAI.exe` (4.1.9.0) y `release/EDITCOREAI-Setup.exe` (4.1.9), construidos desde un árbol limpio en el commit publicado.
- Verificado: 214/214 dependencias dentro de `app.asar`, ningún `.env` ni configuración local, ningún require sin resolver al arrancar.

### Verificación
- `npm run verify:prepackage`: gate 11/11; `npm test` 877 tests, 877 ok, 0 fallos. `npm run check` OK.

---

# RELEASE v4.1.8

## Análisis forense real: errores verificados, verificador honesto y corrección con antes/después

### Análisis que dicen la verdad (4.1.7–4.1.8)
- Motor forense determinista (`editcore-chat-kernel/forensic-checks.js`): sintaxis (JS, ESM, JSON), imports y paquetes, marcadores de conflicto, variables de entorno (solo nombres), referencias rotas en documentación y `git status`. En modo a fondo ("forense", "errores", "bugs", "a fondo", "verifica") también `npm test`, typecheck y build.
- El informe del chat antepone la tabla de chequeos reales con archivo, línea y evidencia; lo no comprobado va a "Hipótesis (no verificadas)".
- Verificador honesto: nunca da OK sin ejecutar algo; si el proyecto no tiene tests lo dice.
- Antes/después: tras cada corrección se re-corren los chequeos y se muestran resueltos, pendientes e introducidos.
- La cola de correcciones de PROCEDE vuelve a generarse (require roto de `./fix-queue`).
- Extractos con integridad real: líneas totales, bytes y sintaxis del archivo completo; `read_file` por rangos (`startLine`/`endLine`); ningún archivo completo se presenta como truncado.
- El ROADMAP escrito a mano ya no se regenera desde la plantilla.

### Chat, kernel y UI (4.1.1–4.1.6)
- Cerebro RAG, `read_pdf`, `screenshot_page`, `docker_ps`; deploy/publish solo con confirmación.
- Modo charla con herramientas de lectura; skills como contexto de sistema y skills de los repos del Cerebro.
- Imágenes adjuntas llegan al modelo; agentes con fecha/hora y respaldo de modelos cuando falla una clave.
- Red neuronal entre agentes, memoria semántica y métricas de tools/modelos.
- Panel Web lista apps de escritorio (Tauri, Electron, NW.js) y proyectos HTML; la barra de estado muestra la versión real.
- Launcher: runtime Electron desde el SSD y bloqueo de dobles clics.
- Diálogo de error de arranque sin rutas internas (stack en `startup.log`).
- Firewall GAFCORE para servicios locales y scripts sin anon key fija.

### Build
- `EDITCOREAI.exe` (4.1.8.0) y `release/EDITCOREAI-Setup.exe` (4.1.8).

### Verificación
- `npm run verify:prepackage`: gate 9/9; `npm test` 899 tests, 898 ok, 1 omitido, 0 fallos. `npm run check` OK.
- Motor forense probado en EDITCOREAI (0 errores, 898 tests pasan), GAFCOREAI (0 errores, 107/107), TICKETIA (script de test sin tests) y CALILI (23 errores reales de typecheck).

---

# RELEASE v4.1.0

## Auditoría forense: agentes que analizan de verdad, seguridad y automatización

### Chat y agentes
- Los pedidos de análisis/auditoría/informe se clasifican como ANALYZE y usan herramientas de lectura; un análisis sin lecturas de disco se marca como no verificado (`editcore-chat-kernel/classify.js`, `orchestrator.js`).
- `replace_in_file` ya no corrompe archivos: si el parche rompe la sintaxis de un archivo válido, no se escribe (`editcore-chat-kernel/tools.js`).
- Reglas anti-alucinación restauradas e identidad "Soy EditCoreAI" (`runtime/editcore-claude-adapter.js`).
- `preload.js`: namespaces duplicados fusionados; antes `contextBridge` abortaba y el renderer perdía la mayoría de APIs.
- ROADMAP del proyecto sin texto de chat, errores de proveedor ni código en bloqueos.

### Seguridad
- Claves del Supabase self-hosted rotadas (eran las demo públicas), incluida la clave ES256 de sesiones.
- Reglas (`.cursorrules`, `AGENTS.md`, `CLAUDE.md`) sin claves: todo referencia `.env.local`.
- Dependencias de producción: `npm audit --omit=dev` = 0 vulnerabilidades (vercel a devDependencies, puppeteer 25, node-pty 1.1, overrides protobufjs/sharp/uuid).
- Eliminadas copias muertas del adapter/renderer y el motor ajeno `gafcore-chat-engine` del paquete.

### Automatización
- `scripts/postinstall.js` (`postinstall` y `npm run setup`): repone Electron, node-pty, Chrome de puppeteer y branding; log en `.editcore/logs/setup.jsonl`.
- `npm run supabase:check | supabase:plan | supabase:rotate`: rotación con respaldo, dump, verificación, rollback automático y registro en `Z RESPALDOS\supabase-key-rotation\`.

### Build
- `npmRebuild: false`: node-pty 1.1 usa prebuilds N-API y no requiere node-gyp/Python.
- Reconstruidos `EDITCOREAI.exe` (4.1.0.0) y `release/EDITCOREAI-Setup.exe` (4.1.0).
- electron-builder 26.15.3 · electron 43.7.0 · node 24.18.0

### Verificación
- `npm test`: 914 tests, 913 ok, 1 omitido, 0 fallos. Gate de pre-empaquetado 9/9. `npm run check` OK.

### Commits
- `1369456` feat: setup post-install automático y rotación de claves Supabase
- `b65f308` chore: dependencias sin vulnerabilidades en prod, copias muertas eliminadas, puppeteer headless
- `865b8ad` fix: análisis reales con tools, replace_in_file seguro, preload sin namespaces duplicados

---

# RELEASE v4.0.2

## Fix: Limpieza de tooling duplicado y actualización de artefactos

### Cambios técnicos

**Arquitectura:**
- Eliminado tooling duplicado/obsoleto del agente: `resources/ui-overlay/runtime/agent-tools.js`, `resources/ui-overlay/runtime/agent-tools-suite.js`, `resources/ui-overlay/runtime/agent-tools-suite.test.js`, `runtime/agent-tools-suite.test.js`
- Eliminada definición duplicada de `create_project` en `main.js`
- Corregido JSON malformado en `brain-seed/architecture-memory.json` (`relations` inválido → `"relations": []`)

**Rendimiento:**
- Escaneo del ecosistema movido a ruta asíncrona (`scanAsync` con `fs/promises`) para no bloquear el hilo principal
- Reducido intervalo de refresco de proyectos en renderer de 30s a 120s
- Aumentado intervalo de supervisión de workers de 5s a 10s

**Build:**
- Reconstruido `EDITCOREAI.exe` y `EDITCOREAI-Setup.exe` desde la rama actual
- Actualizada versión del launcher C# (`scripts/EditCoreAiRootLauncher.cs`) de 4.0.1 → 4.0.2
- Actualizada versión en `package.json` de 4.0.1 → 4.0.2

**Verificación:**
- `node --check main.js` OK
- `node --check runtime/ecosystem-scanner.js` OK
- `node --check renderer.js` OK
- `npm run dist:win` genera `release/EDITCOREAI-Setup.exe` v4.0.2

### Commits
- `11bd5f9` chore: rebuild v4.0.1 and clean orphaned agent tooling
- `5058456` chore: version bump to v4.0.2
- `d52918b` perf: async ecosystem scan and reduced UI timers

### Build
- electron-builder 26.15.3
- electron 43.7.0
- node 24.18.0
