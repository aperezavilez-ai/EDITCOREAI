# MAPA DE CONVERGENCIA — EditCoreAI (una sola entrega)

Base: copia con Entregas 1 + 1.1 + 1.2 ya aplicadas. Suite base al empezar:
**1,070 tests, 1,020 pass, 50 fail**. Suite al terminar: **1,052 tests,
1,050 pass, 2 fail** (los 2 restantes son ambientales, ver §6). En cada bloque
se verificó el diff de NOMBRES de fallos contra la base: **cero fallos nuevos
en todo el proceso**.

---

## 1. Inventario de subsistemas duplicados y veredictos

### Motores de chat/agente

| Pieza | Líneas | Veredicto | Qué pasó |
|---|---|---|---|
| `editcore-chat-kernel/orchestrator.js` (ChatOrchestrator) | 1,660 → 1,672 | **SE QUEDA** | Es la espina. Recibió: guardia única de solo-lectura, reglas de honestidad del análisis, `CHAT_READ_TOOLS`/`WRITE_TOOLS` importados de classify. |
| `runtime/chat-kernel-bridge.js` | 194 | **SE QUEDA** | Ya ejecutaba solo el kernel desde la Entrega 1. Solo se actualizó un comentario que citaba a Cline. |
| `runtime/editcore-cline/` (controller 521 + tool-executor 604 + prompt-builder 83 + index 17 + context-compactor 99) | 1,324 | **SE BORRA** (con 2 cosechas) | Fuera de la ruta viva desde la Entrega 1. Cosechas: (1) `cleanRawToolCallsFromText`, que `main.js` usaba para sanear eventos de progreso → reemplazada por `stripTextToolMarkup` del kernel (`editcore-chat-kernel/parse-text-tools.js`), que cubre el mismo marcado; (2) `ContextCompactor`, que el orquestador sí usa en cada turno → movido a `editcore-chat-kernel/context-compactor.js` (99, **archivo nuevo**). Su test (`test/editcore-cline-engine.test.js`, 14 tests de un motor retirado) se retira como TEST OBSOLETO: probaba un motor que ya no ejecuta nada. |
| `runtime/editcore-claude-adapter.js` (ClaudeAdapter) | 4,377 → 4,386 | **SE QUEDA (documentado, ver §5)** | Es el motor de la ruta viva `agent:run` ("Modo Agente" del renderer), DISTINTA de `editcore:chat`. Tiene consumidores reales que el diagnóstico original no vio (plan unificado, ToolDispatcher propio, TaskManager durable, ModelFailoverCoordinator, checkpoints). Sí se le corrigieron 4 defectos reales (§4-D). Su cosecha al kernel es una operación aparte con pruebas en vivo; NO se forzó. |
| Clase `ChatOrchestrator` dentro de `agent-runtime.js` (raíz) | ~238 de 837 | **SE BORRA** | Tercera copia de orquestador: exportada pero jamás instanciada (verificado por grep en todo el repo). Salieron también sus 5 cargadores perezosos (`getChatSession`, `getTools`, `getCallChat`, `getPersistentMemory`, `getThreadCore`), que solo ella usaba. `agent-runtime.js` queda como módulo de utilidades compartidas (837 → 583): `agentTaskRequirements`, `validateAgentCompletion`, `compactChatHistory`, etc., que sí usan main.js, el adaptador, model-failover y los tests. |
| `agent-controller.js` (raíz) | 125 | **SE BORRA** | Máquina de estados "idéntica a la de Cline". Cero requirers de código (solo aparecía en datos generados de `.editcore/`). |
| `runtime/agent-runtime.js` (clase `AgentRuntime`) | 339 | **SE BORRA (cosechado su consumidor)** | Fork que sombreaba al `agent-runtime.js` raíz: `runtime/intent-orchestrator.js` lo requería primero y, como la clase no tiene `agentTaskRequirements`, esa función quedaba en `undefined` vía optional chaining (feature muerta en silencio). El intent-orchestrator ahora requiere el de la raíz, que sí la exporta. |
| `runtime/intent-orchestrator.js` | 1,228 | **SE QUEDA** | Clasificador de intenciones de `agent:run`; su único cambio es el require de arriba. |

### Despachadores de herramientas

| Pieza | Veredicto | Qué pasó |
|---|---|---|
| `editcore-chat-kernel/tools.js` (`execute` + `DEFINITIONS`+`EXTRA_DEFINITIONS`) | **SE QUEDA** | Despachador único del kernel. Sumó el case `graphify_project` (el runner existía y el despachador no lo conocía: caía en "Herramienta desconocida"). |
| `runtime/tool-dispatcher.js` (144) | **SE QUEDA (documentado)** | Despachador de la ruta `agent:run`/adaptador (2 instancias en main.js + `register-agent-capability-tools.js`, 980 líneas de registros). Vive o muere con la cosecha del adaptador (§5); no se tocó. |
| `runtime/register-agent-capability-tools.js` (980) | **SE QUEDA (documentado)** | Registra tools solo para el dispatcher del adaptador, incl. duplicados de `list_skills`/`brain_skill`. Mismo destino que el punto anterior. |

### Selección de modelo / routers

| Pieza | Líneas | Veredicto | Qué pasó |
|---|---|---|---|
| `auto-model-selection.js` (raíz, UMD → renderer) | 895 → 912 | **SE QUEDA — es EL motor Auto vivo** | Se le restauró el scope APICredits (§4-C). Entra por `<script>` en index.html; el kernel no lo usa. |
| `editcore-chat-kernel/model-router.js` | 140 → 35 | **SE QUEDA recortado** | `pickModel` es el router del kernel (lo usa el orquestador). Se borró el bloque de estadísticas (`pickModelWithStats`/`recordModelOutcome`/`getModelStats`/`resetModelStats`, ~105 líneas): **cero llamadores en todo el repo**. |
| `runtime/smart-router.js` | 182 | **SE BORRA** | Tercer router, muerto: 4 handlers IPC en main.js + puente `editcoreSmartRouter` en preload.js sin UN solo consumidor en renderer/chat-home/index.html. Retirados módulo, handlers, puente y su test unitario (TEST OBSOLETO: probaba un módulo desconectado). Modelos fósiles (gemini-1.5, claude-3) incluidos. |
| `runtime/model-failover.js` | — | **SE QUEDA** | Failover de la ruta adaptador; sin cambios. |

### Catálogos de skills

| Pieza | Líneas | Veredicto | Qué pasó |
|---|---|---|---|
| `brain-seed/skills/` (100 SKILL.md, 21 MB) | — | **SE QUEDA** | Única fuente de datos. Nadie la genera en código; es semilla versionada. |
| `editcore-chat-kernel/skills-catalog.js` | 583 → 589 | **SE QUEDA corregido** | Es el catálogo del orquestador cuando main no pasa `skillsPrompt` (pasa en `editcore:chat`). Correcciones §4-S: cuerpo COMPLETO (fuera el corte de 1,600 y el de 7,000) y raíz `.editcore/skills` del proyecto (era ciego a las skills instaladas). |
| `runtime/skills-engine.js` | 434 | **SE QUEDA** | Catálogo del panel y de la ruta `agent:run` (main lo usa para `skills:list` y para construir el `skillsPrompt` del kernel). Ve las 6 fuentes; su truncado de 8,000 avisa con la ruta completa. Convive con el del kernel por diseño de rutas (panel/main vs fallback del orquestador); unificarlos del todo exige portar el ranking por kind del kernel al engine — anotado en §5. |
| `brain-service.js` (`listSkills`/`assembleContext`) | 894 | **SE QUEDA (documentado)** | Tercer lector de skills, pero es la API del Cerebro (items instalados, repos) y lo usan el inspector y `brain:audit`; su `assembleContext` alimenta `agent:verify/plan`. No es intercambiable con los catálogos sin reescribir el Cerebro. |
| `runtime/skill-registry.js` | 216 | **SE QUEDA (documentado)** | Nombre engañoso: es heal/purge del Cerebro, solo lo invoca `brain:audit`. Fuera de la ruta de chat. |

---

## 2. Contratos únicos (punto 3 del encargo)

### (a) Catálogo de herramientas — una sola clasificación
- La clasificación lectura/escritura vive SOLO en `editcore-chat-kernel/classify.js`
  (`READ_ONLY_TOOLS`, `WRITE_TOOLS`, `TOOL_ALLOWLIST`).
- Estaba desactualizada frente al despachador real: faltaban `build_project`,
  `git_commit`, `git_push` (escritura, con guardia en `execute`) y `read_pdf`,
  `docker_ps`, `screenshot_page` (lectura pura). Se completó desde el despachador.
- `tools.js getToolDefinitions()` mantenía su propio Set de escritura a mano
  (11 nombres, derivado: no conocía `delete_file` ni `move_file`). Ahora usa
  `WRITE_TOOLS` de classify. La oferta resultante es idéntica sobre el catálogo
  real (22 definiciones; 12 en solo-lectura) — verificado.
- El orquestador mantenía su propia copia de `CHAT_READ_TOOLS` (con dos nombres
  fantasma sin definición ni despachador: `web_scrape`, `list_brain`). Ahora
  importa `CHAT_READ_TOOLS` de classify, **derivado** de `READ_ONLY_TOOLS`:
  si un nombre sale de solo-lectura, desaparece de charla solo; jamás puede
  colarse una herramienta de escritura (verificado: intersección vacía).
- Se retiró el import muerto de `TOOL_ALLOWLIST` en el orquestador.

### (b) Política de proveedores — un solo módulo
- `runtime/platform-defaults.js` (45 → 74) es EL módulo de política:
  - `assertProviderAllowed` **ya no es no-op**: en app instalada (packaged)
    sin sesión admin, solo permite el prefijo del ai-proxy del servidor de
    EditCoreAI; cualquier otra URL lanza `PROVIDER_LOCKED`. Los dos llamantes
    vivos (`runtime/ai-core.js` y el provider del kernel) llaman sin options:
    el módulo detecta `packaged` con `isPackagedApp()` de editcore-cloud-config.
  - `setAdminInfra(on)` ahora SÍ guarda el flag; `adminInfraEnabled()` y
    `defaultSupabaseOrigin()` lo respetan (sin infra admin, el origen por
    defecto es `""`: un usuario sin Supabase propio no recibe el del admin).
  - `cloudProxyPrefix` se exporta (era código muerto sin exportar).
- `main.js` sincroniza el flag con la sesión real: en las rutas cloud,
  `setAdminInfra(access.role === "admin" && apiKey !== CLOUD_SESSION_KEY)`
  (antes `setAdminInfra(true)` incondicional en 4 sitios); las ramas directas
  ya no lo fuerzan. Y en `agent:run` la ruta se decide por rol:
  `if (access.role !== "admin" || apiKey === CLOUD_SESSION_KEY)` → ai-proxy.
- **APICredits consistente en todas las capas** (política: segundo gateway
  del administrador, junto a ME AI):
  - `runtime/meai-single-key.js`: ya no borra `providers.apicredits` ni filtra
    sus perfiles en cada lectura/escritura de la bóveda; un perfil oculto
    vuelve con su status (`hidden`+`hiddenStatus` → restaurado).
  - `main.js`: fuera la purga de arranque en `ensureDirectUpstreamProfiles`
    (borraba el proveedor, sus perfiles y reescribía el chat activo a ME AI)
    y el filtro `!model.startsWith("apicredits/")` en `expandGatewayCatalogModels`.
  - `renderer.js`: `PRIMARY_PROVIDER_KEYS = ["meai", "apicredits"]`; fuera el
    filtro que excluía perfiles APICredits del catálogo del chat;
    `isCurrentUserAdmin()` lee la sesión real (`window.__editcoreSession`)
    en vez de devolver `true` siempre; `filterModelOptionsForRole` filtra de
    verdad (no-admin: solo grupo ME AI, etiqueta "Modelos"); `autoScopes`
    por rol (admin: all/meai/apicredits; usuario: solo meai).
  - `auto-model-selection.js`: `UPSTREAM_ORDER = ["meai", "apicredits"]`,
    scope `apicredits` válido en `normalizeAutoProviderScope`/
    `isScopedAutoProvider`/`formatAutoLabel`, buckets por upstream y 13 filas
    APICredits en `MODEL_DUTY_CATALOG` (antes `describeModelDuty("apicredits/…")`
    resolvía al alias ME AI con el rol equivocado).

### (c) Selección de modelo — rutas que quedan
1. Picker/Auto del renderer → `auto-model-selection.js` (único motor Auto).
2. Kernel → `model-router.js pickModel` (único router del kernel).
3. Failover entre perfiles → `runtime/model-failover.js` (ruta adaptador).
SmartRouter eliminado; estadísticas del model-router eliminadas.

---

## 3. Skills (punto 4 del encargo)
- **Cuerpo completo**: `skills-catalog.js` ya no corta a 1,600 caracteres por
  skill ni a 7,000 el bloque. `loadManifestBody` devuelve el SKILL.md entero
  (los `mcp.json` conservan su tope de 800, no son cuerpo de skill).
  Verificado ejecutando: un SKILL.md de 10,474 caracteres entra al prompt
  CON SU COLA (antes entraban 1,600). La selección sigue siendo por
  relevancia (máx. 4 skills), pero lo seleccionado va completo.
- **`.editcore/skills` visible**: `resolveSkillsRoots` ahora incluye
  `<proyecto>/.editcore/skills` como primera raíz del proyecto — las skills
  que instala `install_skill` ya las ve el catálogo del kernel (antes solo
  las veían el engine y el Cerebro). Verificado con una skill sintética.

---

## 4. Suite reconciliada (punto 5) — los 50 fallos base, uno por uno

Resultado: **48 resueltos** (44 en código, 4 tests actualizados) y **2
ambientales** que quedan. Cero fallos nuevos (diff de nombres tras cada bloque).

### A. DEFECTO REAL — corregido en código (44)

**A1. Verificación honesta (`agent-runtime.js`) — 4 tests.**
`run_command` estaba en `MUTATION_TOOLS` y `classifyAgentStep` miraba mutación
antes que verificación: la rama `verification` era código muerto y
`validateAgentCompletion` además contaba el propio lint como "última
escritura", dejando la verificación fuera de la ventana. Ahora la
clasificación manda: un `run_command` de test/build/lint/check ES
verificación, y "escritura" = lo que `classifyAgentStep` llama `mutation`.
→ N2, C5b, "la verificacion reconoce mutaciones con rutas absolutas…",
"el controlador exige escribir y verificar una tarea de correccion".

**A2. Saludo degradado (`classify.js`) — 1 test + sonda (d).**
`classify("hola", {fullAccess:true})` devolvía ASK con `allowWrite:true`.
Un saludo puro (regex anclada a todo el mensaje) es CHAT sin herramientas en
cualquier modo de permisos. → "crear/mover/analizá activan tools (no chat ciego)".

**A3. Rutas con espacios (`classify.js`) — 1 test + sonda (e).**
Las regex de rutas absolutas cortaban en el primer espacio y la rama Unix no
tenía la guardia `isInsideRoot` (el mapa del proyecto aplastaba la ruta
externa a "."). Recorte por existencia generalizado a Windows y Unix.
→ "extractListTarget respeta rutas absolutas con espacios fuera del proyecto".
(En la clasificación previa figuraba como ambiental/intermitente; al
reproducirlo era determinista en la rama Unix: DEFECTO REAL.)

**A4. Despachos que faltaban — 2 tests.**
`graphify_project` no tenía case en `tools.execute` (el runner existía) →
despachado. El dispatcher de especialistas capturaba "pipeline CI/CD en
GitHub Actions y deploy en Vercel" como releases; regla CI/CD previa →
DEVOPS. → "tools.execute ejecuta graphify_project…",
"Subagents Dispatcher - identifies specialists accurately".

**A5. Candado e infra admin (`platform-defaults.js` + `main.js`) — 5 tests.**
Detalle en §2(b). → "Candado: usuario de la app instalada solo usa la IA del
servidor", "Conexiones: un usuario sin Supabase propio…", "Conexiones: el
interruptor del administrador…", "La app desvía las consultas de usuarios al
servidor…", y la mitad main.js de "Ver como usuario: las consultas del admin…".

**A6. Saldo real (`runtime/credit-ledger.js`) — 7 tests.**
`balanceView()` devolvía siempre 999999/admin/ilimitado y `checkCanRun()`
siempre ok, contra el propio encabezado del módulo. Restaurado: saldo, rol y
estado vienen de `refreshAccount()`; sin sesión → `NO_SESSION`; servidor caído
→ fail-closed (nunca infinito); suspendido → `ACCOUNT_SUSPENDED`; sin saldo →
`OUT_OF_CREDITS`; canje refleja el saldo del servidor (105, no 999999).
→ los 6 de credit-ledger + "web: el administrador entra con su panel…".

**A7. APICredits (`auto-model-selection.js`, `meai-single-key.js`, `main.js`,
`renderer.js`) — 9 tests.** Detalle en §2(b).
→ 6 de Auto (scope, equilibrio 50/50, roles, catálogo explícito, endurecido),
"APICredits sigue disponible para el administrador…",
"panel: ME AI con una sola clave y APICredits para el administrador",
y los 3 de rol en renderer cuentan también aquí ("usuario normal: solo
modelos ME AI…", "sin sesión se trata como usuario normal",
"proveedores y 'Configurar modelos' solo para el administrador").

**A8. Adaptador Claude (defectos puntuales) — 4 tests.**
Piso de presupuesto de lectura 150,000 → 80,000 (pisaba el `maxTokens` de la
tarea); `ConversationLog` con 16,000 chars/3 turnos → 80,000/8 (la poda
destruía la evidencia que su propia auditoría espera); el prompt de sistema
vuelve a envolverse con `withEliteCommunicationPolicy(...)` (se importaba y
nunca se llamaba), recupera el bloque CONTRATO DE TRABAJO y la
`analysisGuide` que se construía y no se usaba.
→ "maxTokens de la tarea reemplaza presupuestos internos demasiado bajos",
"el agente audita y compacta contexto preventivamente…",
"inyeccion: adapter agente envuelve system prompt",
"agentes: knowledge pack y contrato de trabajo en fuentes".

**A9. Frases de verificación y honestidad (renderer + orquestador) — 4 tests.**
El renderer presentaba un lint fallido como "(evidencia de diagnostico)";
ahora "(evidencia de verificacion; no es fallo de la herramienta)" con el
contrato C5 junto al código. GATE de versión: `buildVersion` 4.4.7.0 →
4.4.8.0, `package-lock.json` 4.4.5 → 4.4.8, `EDITCORE-MANIFEST.md` → **4.4.8**.
El prompt de análisis del orquestador prohíbe reportar extractos como
archivos 'truncados' y obliga a etiquetar lo no verificado bajo
"## 🔎 Hipótesis (no verificadas)".
→ C5, "GATE: 6 contratos de usuario", "GATE: versión…",
"el prompt de análisis prohíbe reportar extractos…",
"el chat usa los chequeos reales en análisis…".

**A10. «Ver como usuario» (`chat-home.js`, `index.html`, `chat-home.css`) — 3 tests.**
La feature estaba neutralizada: `viewSessionFor` ignoraba la vista y
devolvía siempre admin con saldo infinito; `setPreviewAsUser(_on)` ponía
siempre `false`; los botones ni existían en el DOM. Restaurado todo: sesión
efectiva de usuario real al previsualizar, botones `idePreviewBtn`/
`ideExitPreviewBtn`/`chatHomePreviewBtn`/`chatHomeExitPreviewBtn` (ocultos
por defecto), `ideAdminBtn` oculto por defecto, sincronía por rol en
`syncAdminShortcuts`, salida con botón o Escape, franja de 3px que no tapa
nada, y el engrane ⚙ abre administración solo al admin (al usuario, su saldo).
→ los 2 de admin-presence + "el IDE tiene engrane…" (+ la mitad chat-home
del test de Mercado Pago de A5).

**A11. Portabilidad (`runtime/db-manager.js`) — 1 test.**
`_isBinaryAvailable` usaba `where` (solo Windows): en Linux/CI reportaba
sqlite no disponible aunque existiera. Ahora `where` en win32, `which` en
el resto. → "getSchema returns table metadata…" (+ su suite DbManager).

### B. TEST OBSOLETO — actualizados con justificación (4)
1. `test/conversation-loop.test.js` — "la memoria de la corrida anterior…":
   el adaptador cambió el encabezado del bloque a "Avance previo verificado:"
   (la memoria SÍ entra al prefijo, con recorte a 400 chars). El test buscaba
   el literal anterior `MEMORIA DE LA CORRIDA ANTERIOR`.
2. `test/chat-agent-reconstruction.test.js` — "Chat conserva analisis…": el
   renderer añadió la guardia anti-saludo (`const isAgent = !isCasualGreeting
   && modeDecision.isAgent;`); el test afirmaba la línea previa sin guardia.
   Los `deepEqual` de comportamiento ya pasaban.
3. `test/elite-communication-policy.test.js` — "politica elite contiene
   ortografia…": la política V5 dice "español impecable (tildes, ñ, ¿ ¡)";
   el test buscaba la redacción anterior "Español correcto". Contenido igual.
4. `test/hard-locks.test.js` — H2b: la prohibición vive hoy como filtro
   activo de la frase "Verificacion completada con evidencia real" en textos
   de análisis (la guarda de comportamiento pasa); el literal
   `PROHIBIDO "Verificacion completada…` de la versión anterior ya no existe.
   El assert se actualizó al mecanismo vigente.
Además, 2 archivos de test RETIRADOS por probar motores eliminados:
`test/editcore-cline-engine.test.js` (14 tests del motor Cline) y
`test/smart-router.test.js` (4 tests del router sin consumidores).
Por eso el total baja de 1,070 a 1,052 (−18 tests).

### C. AMBIENTAL — quedan (2)
1. `RolePolicyGuard: Standard user is BLOCKED from modifying or reading
   EditCoreAI core` — usa rutas Windows (`d:\PROGRAMAS IA\EDITCOREAI\main.js`)
   evaluadas con `path` POSIX en esta VM Linux: la raíz nunca coincide. En el
   Windows de Luis, `path.win32` resuelve como el test espera.
2. `resolveAuthorizedRoot nunca autoriza la raiz del disco` — los asserts de
   raíz pasan; falla el positivo `resolveAuthorizedRoot("D:\\PROGRAMAS IA")
   === "D:\\PROGRAMAS IA"`, que exige que ese directorio exista en disco y
   que `path.isAbsolute("D:\\…")` sea cierto: ambas son semántica Windows.
Documentados, sin tocar: "arreglarlos" sería falsear rutas POSIX o
debilitar la política de rutas.

---

## 5. Lo que NO se completó (y por qué)

1. **Cosecha del ClaudeAdapter / ruta `agent:run` hacia el kernel.**
   Es una ruta viva completa (renderer → `agent:run` → plan unificado →
   adaptador con su ToolDispatcher, TaskManager durable con checkpoints,
   ModelFailoverCoordinator y ~980 líneas de registros en
   `register-agent-capability-tools.js`). El kernel no tiene equivalentes
   1:1 de plan unificado ni de task manager durable; migrarla sin poder
   probarla en vivo (Electron + proveedores reales) arriesga el Modo Agente
   entero. Queda como operación propia, con el adaptador funcionando y sus
   4 defectos corregidos (A8). Mientras tanto conviven DOS motores por
   diseño de rutas: `editcore:chat` = kernel; `agent:run` = adaptador.
2. **Unificación total de catálogos de skills.** Se cumplieron los dos
   mandatos (cuerpo completo + `.editcore/skills` visible en el kernel),
   pero siguen existiendo tres lectores (kernel, engine, brain-service)
   porque cada uno sirve a una ruta distinta (fallback del orquestador,
   panel/`agent:run`, Cerebro). Borrar el del kernel exige portar su
   ranking por kind/mensaje (`SKILL_KEYWORD_MAP` + `scoreSkill`) al engine
   y recablear el fallback del orquestador; es el siguiente paso natural
   tras la cosecha del adaptador.
3. **`brain_skill` como tool del kernel.** Hoy el agente del kernel no puede
   pedir el cuerpo de una skill a demanda (solo lo inyectado en el prompt,
   ahora completo). La tool existe solo en la ruta del adaptador
   (`register-agent-capability-tools.js`). Anotado como mejora, no se
   inventó la API en esta entrega.
4. **`graphify_project` no se añadió a DEFINITIONS** (solo se despacha): la
   oferta al modelo no cambia en esta entrega; el despacho ya no responde
   "Herramienta desconocida" cuando el modelo o un subagente la invoca.

---

## 6. Sondas de comportamiento (proveedor simulado vía `provider.callChat`)

Script: `sondas-convergencia.js` (en `editcoreai-fixes/`, NO es archivo del
proyecto; se ejecutó contra la copia con el proveedor simulado).
Resultado final: **5/5 PASS**.

- (a) "¿QUE FALTA PARA QUE LA IA FUNCIONE COMO DEBE SER?" → kind CHAT, pasos
  [read_file], NO invoca `check_connections`, NO cierra con "Sigue leyendo
  el archivo…"; responde sobre `app.py` con contenido real.
- (b) `check_connections` se despacha vía `tools.execute` y responde
  (ok:true, report de 408 caracteres).
- (c) Solo-lectura: `replace_in_file` NO se ofrece
  (`getToolDefinitions({allowWrite:false})`), `tools.execute` lo rechaza, y
  en un turno orquestado con `permissionMode:"readonly"` el paso queda
  registrado como bloqueado (ok:false, `blockedReadOnly`) y el archivo queda
  intacto. La guardia previa al despacho se generalizó: antes solo cubría
  `write_file`/`replace_in_file` en modo readonly explícito; ahora corta
  TODAS las herramientas de `WRITE_TOOLS` cuando el turno no puede escribir
  (el `runImplementer` ni siquiera revisaba permisos).
- (d) `classify("hola")` = CHAT, también con `fullAccess:true`
  (allowTools:false).
- (e) Rutas con espacios: `extractListTarget("lista los archivos de
  /tmp/…/CARPETA CON ESPACIOS")` devuelve la ruta exacta (y con punto final),
  y `classify("mueve el proyecto a D:\\PROGRAMAS IA\\ALFA LUBES")` = EXECUTE.

## 7. Conteos antes → después (líneas)

| Archivo | Antes | Después |
|---|---|---|
| `main.js` | 13,082 | 13,046 |
| `renderer.js` | ~17,050 | 17,060 |
| `preload.js` | 987 | 980 |
| `chat-home.js` | ~3,510 | 3,530 |
| `index.html` | ~1,378 | 1,383 |
| `auto-model-selection.js` | 895 | 912 |
| `agent-runtime.js` (raíz) | 837 | 583 |
| `runtime/platform-defaults.js` | 45 | 74 |
| `runtime/meai-single-key.js` | 101 | 104 |
| `runtime/credit-ledger.js` | ~330 | 338 |
| `runtime/editcore-claude-adapter.js` | 4,377 | 4,386 |
| `runtime/intent-orchestrator.js` | ~1,231 | 1,228 |
| `editcore-chat-kernel/classify.js` | 444 | 482 |
| `editcore-chat-kernel/orchestrator.js` | 1,660 | 1,672 |
| `editcore-chat-kernel/tools.js` | 1,376 | 1,386 |
| `editcore-chat-kernel/skills-catalog.js` | 583 | 589 |
| `editcore-chat-kernel/model-router.js` | 140 | 35 |
| `editcore-chat-kernel/context-compactor.js` | — (nuevo, cosechado de Cline) | 99 |

**Borrados del disco:** `agent-controller.js` (125), `runtime/agent-runtime.js`
(339), `runtime/editcore-cline/` (1,324 en 5 archivos), `runtime/smart-router.js`
(182), `test/editcore-cline-engine.test.js`, `test/smart-router.test.js`.
Total retirado: ~1,970 líneas de motores/routers duplicados o muertos, más
~340 líneas muertas dentro de archivos que se quedan (clase orquestadora de
agent-runtime + estadísticas del model-router).
