# MAPA — Corrección integral v4.9.0 (Bloques 1-10 del PROGRAMA-CORRECCION)

Base: v4.8.0 publicada + paquete v4.8.1 integrado. Construcción en UN solo árbol, bloques en serie,
cada uno con pruebas de comportamiento nuevas (costuras inyectadas, sin red ni CLI reales salvo git
en repos temporales, patrón de test/publicacion-verificada.test.js). Marcadores [EDITCORE-INTEGRAL-Bn].

Suite: base 1.184 → final **1.245 pruebas** (1.243 pasan en Linux; los únicos 2 fallos son los
ambientales conocidos: project-path-policy resolveAuthorizedRoot y role-policy-guard; en Windows
debe dar **1.245/0**). La bajada neta frente a B9 (1.280) es la cuarentena del Bloque 10:
−36 pruebas del adaptador Claude salen de la suite y +1 de comportamiento entra. La cuarentena se
ejecutó aparte como referencia: 43/43. El script scripts/acceptance-kernel.js corre fuera de la
suite y da PASS (exit 0).

Lo INTOCABLE del programa no se tocó: compuerta única de escritura + 2ª capa en tools.execute,
cierre honesto por límite, banners deterministas (extendidos, no sustituidos), diseño del humo de
deploy-one-click (reintento único, firstLogError, orden de claves del fallo), publish-pipeline en su
capa (secretos/-F/ok:false con resultado íntegro), agent-git como patrón, snapshots en su
captura/poda, replace_in_file + anti-blob, serialización del kernel (una cadena: el Bloque 7 añade
plazo sin paralelizar), guarda anti-rehidratación, pre-chequeo de saldo fail-closed, base FTS5 del
cerebro, criterio del expediente sobre timeouts blandos.

---

## Bloque 1 — Verdad del turno
CONSTRUIDO:
- Resumen factual del kernel (buildKernelFactSummary/auditSubagentSteps en orchestrator.js):
  por cada replace_in_file el hunk real oldText→newText resumido por el kernel; antepuesto al relato
  del modelo en el cierre. El modelo puede narrar; los hechos los firma el kernel.
- Compuertas de cierre persistentes: MAX_CLOSE_NUDGES=3 (antes 1 disparo) y ventana extendida a la
  penúltima iteración (i < stepsLimit-1). Señal estructural nueva: mutación pedida + autorizado +
  cero escrituras ⇒ el kernel adjunta «nada quedó aplicado», suene como suene la prosa.
- Delegación real y auditada: applyWrite/applyReplace del bounded-implementer cableados en
  effectiveHelpers a tools.writeFile/replaceInFile con la identidad de coordinación de la corrida
  (mismos locks que el supervisor), solo con autorización. Roles fantasma
  (security/database/ui_ux/devops/analyst/verifier) retirados de la definición de invoke_subagent;
  si se piden, execute lo anuncia (degradedRole, roleNotice) y el cierre lo declara como
  exploración, no como auditoría. planned:true se declara «PLANIFICADO, NO aplicado» al cerrar.
- La ⚠️ con causa: verifier.js lee run.output (el campo que runCommand sí devuelve), un blob de
  solo separadores ya no es error en blanco, y en runPostWriteVerify la causa concreta precede a la
  note genérica. softTimeout ⇒ ok:false en el bloque visible (⏱️, nunca ✅).
- Verificación real relacionada (repair-guard.js commandRelatesToChange): un comando verde solo
  cuenta si nombra un archivo tocado o es el build/test/typecheck genérico del proyecto, y debe ser
  posterior a la última escritura. Una captura FALLIDA ya no es evidencia: la compuerta sigue
  bloqueando; el fail-open tras 2 bloqueos se declara en la narrativa.
DECLARADO: applyReplace delegado usa tools.replaceInFile (primera coincidencia localizada); un
patch con replaceAll:true aplica la primera sustitución y el resto queda visible en el resultado
del patch — no es silencioso.
TESTS VIEJOS ACTUALIZADOS: test/repair-guard.test.js (afirmaba que una captura con ok:false contaba
como evidencia — el comportamiento roto exacto; ahora afirma false para la fallida y true para la
exitosa). Nuevos: test/verdad-turno-b1.test.js (7).

## Bloque 2 — Economía de contexto
CONSTRUIDO:
- Inyección de skills = ÍNDICE (skills-catalog.js): nombre + cuándo usarla (≤260) + extracto
  (≤600) + instrucción de cargar el cuerpo con read_skill. El cuerpo completo solo viaja vía
  read_skill (intacta, probada con su cola). Segunda vía acotada igual: runtime/skills-engine.js.
  Selección UNA vez por turno (buildSkillsTurn): ids inyectados ≡ ids narrados.
  Medición: prompt de skills de construcción 85.243 → 9.005 caracteres; «hola» 4.640.
- Presupuesto agregado de turnContext: TURN_CONTEXT_MAX_CHARS=16.000 con tiers
  (esencial/normal/accesorio), recorte con marca declarada «[contexto recortado por presupuesto]»;
  el expediente (≤3.500) queda fuera del presupuesto a propósito por esencial.
- Compactador con umbral real: estimación declarada ~4 caracteres/token; compactMessages compacta
  por tamaño estimado además de por cantidad, podando por UNIDADES (jamás deja un tool result
  huérfano de su tool call).
DECLARADO: la estimación de tokens es heurística declarada, no el tokenizador del proveedor; el
«cuándo usarla» sale del frontmatter (o del mapa de palabras clave si no hay frontmatter).
TESTS VIEJOS ACTUALIZADOS: ninguno (los contratos vigilados se conservaron a propósito).
Nuevos: test/economia-contexto-b2.test.js (9).

## Bloque 3 — Memoria de hechos
CONSTRUIDO:
- Destilación de hechos desde los steps al cerrar (thread-core.js distillTurnFacts):
  archivo↔sección/símbolo distinguiendo «contiene» (definido ahí) de «renderiza/usa» (importado y
  usado, no definido); asset↔archivo (y sección solo si el marcador es inequívoco); lecturas con
  rastro (read). Decisiones SOLO afirmables por el kernel: autorización dada (mensaje de aprobación
  o marca de instrucción autorizada + flag), opción elegida con verbo explícito, descarte explícito
  del usuario. Nada se infiere de la prosa del modelo.
- Sección de hechos propia en el expediente (thread-memory.js): tope MAX_FACTS=80, dedupe por clave
  semántica, reserva protegida FACTS_RESERVE_CHARS=1.100 DENTRO del tope de 3.500 — si hay que
  cortar, se corta la prosa. noteDecision deja de tener 0 llamadores en producción.
- retrieveRelevant reescrito: hechos primero, normalización sin acentos, sinónimos mínimos
  declarados (hero↔portada, foto↔imagen, home↔inicio), CON umbral (sin coincidencia no hay ruido).
- noteVerified también en creación cuando hay verificación real (criterio B1); softTimeout
  excluido explícitamente (intocable respetado).
DECLARADO: las lecturas de las rutas previas a runModelTask (explorador/analista de ASK/ANALYZE en
handle()) y search_files (solo devuelve rutas) no pasan por rememberOut y NO se destilan en esta
entrega — la M-5 en vivo debe correrse por la ruta Agente. Asset sin sección cuando el marcador es
ambiguo (>1 candidato). «quita/elimina» no cuentan como descarte (son instrucciones de cambio). El
modo de autorización por sí solo (sin mensaje) no genera hecho-decisión.
TESTS VIEJOS ACTUALIZADOS: ninguno. Nuevos: test/memoria-hechos-b3.test.js (6).

## Bloque 4 — Herramientas con evidencia completa
CONSTRUIDO:
- Política de truncamiento por herramienta (tools.js TOOL_PAYLOAD_CAPS + shapeToolPayload):
  cabeza+cola 55/45 con elipsis declarada y conteo; topes: default 4.000, read_file 6.000,
  run_command/build_project/git_diff 12.000, read_skill 32.000 (su canal bajo demanda del B2),
  delegate_parallel 20.000, captura 10.000 (diagnostics primero), publish/deploy/connect 12.000 SIN
  reordenar sus claves (el fallo de deploy sobrevive íntegro y en orden — probado).
- run_command delega en process-runner.js (UNA implementación): conserva la cola, detecta severos
  y onSevereError por fin se lee y actúa; killProcessTree nuevo (taskkill /T /F) para timeout y
  aborto. La cadena de aborto intocable se conserva (no arranca abortado, temporizador, árbol).
- search_files: modos literal|regex DECLARADOS en la definición (regex inválido ⇒ error, no 0 hits
  mudos), búsqueda por nombre/ruta para cualquier archivo (los binarios se buscan por nombre),
  extensiones ampliadas, resultados con línea+fragmento, total y truncated:true. parse-text-tools
  aplica unescapeTextBlob también a query (el literal \n ya se encuentra por la vía texto).
- rollback_last_change REAL: snapshot.js rollbackFileChange (restaura SOLO ese archivo desde el
  snapshot previo; si nació en esa escritura, lo elimina), definición + case en tools.js con 2ª
  capa, clasificado ESCRITURA (pasa por la compuerta: en solo lectura se bloquea), ofrecido en modo
  agente, y el resumen factual del kernel lo registra como hecho.
- start_preview: definición + case que envuelve helpers.startPreview (bridge lo expone;
  main lo conecta a startProjectPreview en las 3 rutas). Sin helper ⇒ ok:false honesto
  (previewUnavailable), nada de éxito falso. Clasificada LECTURA (no muta archivos del proyecto;
  su rastro es el log de runtime del IDE — mismo criterio que .editcore/vision en v4.8.1).
- Extra §5: git_log/git_diff dejan de ser fantasmas (definición + case + vía texto).
DECLARADO: manage_process no se portó (vive en el dispatcher; start_preview envuelve la costura
que main ya tiene). Rollback con granularidad de archivo, no de hunk (los snapshots no guardan
hunks). La rama PowerShell del runner y el arranque real del preview por Electron solo se ejercitan
en la máquina de Luis.
TESTS VIEJOS ACTUALIZADOS: ninguno. Nuevos: test/herramientas-evidencia-b4.test.js (14).

## Bloque 5 — Permisos que no rompen el flujo
CONSTRUIDO:
- La autorización viaja como DATO: renderer (payloads chat y agente) → main (editcore:chat y
  agent:run por fin LEEN planAuthorized/planAuthorizedExecution/authorizedContinuation; antes solo
  permissionHint==="full") → bridge (normaliza) → kernel (_handleCore unifica inputPlanAuth).
  Con el prompt transformado SIN la palabra suelta, la escritura sale a la primera; sin el dato,
  sigue cortada (garantía v4.7.5 intacta).
- Modo efectivo: defectos convergidos (renderer nace «step»/allowWrite:true como main),
  normalizePermissionMode única en classify.js, y el fallo del setPermission de arranque ya no se
  traga: aplica el modo local y lo dice en la barra de estado. ANUNCIO: chat nuevo (dato isNewChat
  por la misma ruta) + modo restrictivo heredado ⇒ línea de modo como primera línea visible del
  primer turno (buildModeAnnouncement), también por onProgress y en out.modeAnnouncement.
- Clasificación total de lo ofrecido: 31 definiciones, 0 sin clase. invoke_subagent = ESCRITURA
  (muta desde B1: la compuerta la corta con blockedReadOnly/needsAuthorization), delegate_parallel =
  LECTURA. Mapa único: tools.execute ya derivaba su set de classify.js (sin lista divergente).
- Forenses y verifier bajo la misma autorización que run_command: forensic-checks gana
  opts.allowExecution; en solo lectura (o step sin autorizar) ningún script del proyecto corre ni
  se escribe el stub de .next/types, y el resultado DECLARA la omisión
  («Chequeos con ejecución omitidos en modo solo lectura…»). Con autorización, corren como antes.
DECLARADO: el cableado renderer/main no se ejecuta en la suite (sin DOM/Electron) — cambios mínimos
y quirúrgicos; la conducta se probó en las costuras bridge/kernel y la cierra la C-1 en vivo por la
ruta Agente. Los ~24 fantasmas clasificados SIN definición ofrecida quedan para el Bloque 10 (no
se clasificó ni desclasificó nada para disimularlos). checkGit (git status, consulta VCS) sigue en
solo lectura: no ejecuta código del proyecto.
TESTS VIEJOS ACTUALIZADOS: cabecera de test/permission-modes-kernel.test.js (anotación: su
inyección directa de planAuthorizedExecution es desde B5 la ruta real que main/bridge producen;
ninguna aserción cambió). Nuevos: test/permisos-flujo-b5.test.js (12).

## Bloque 6 — Detener detiene todo; la sesión no muere a mitad de turno
CONSTRUIDO:
- Señal en acciones externas: runExternalAction lee helpers.abortSignal — abortada antes de
  lanzar ⇒ no publica (cancelledBeforeLaunch); con el request ya salido ⇒ el resultado DECLARA
  cancellationLate («la cancelación llegó tarde: el despliegue X sí salió»). deploy-one-click
  acepta signal en su runProcess (pre-aborto ni nace; en curso mata el hijo, DEPLOY_ABORTED) y en
  deployOneClick para Vercel/Netlify; publish-pipeline y project-connect observan la señal entre
  pasos con la misma declaración.
- Sesión viva: ante NO_SESSION se re-pide token UNA vez (costura helpers.refreshAccessToken que
  main conecta a authManager en las 3 rutas, y refreshApiKey dentro de provider.callChat) y el paso
  se reintenta con token fresco; persistente ⇒ error de sesión. Token null tras pre-chequeo OK =
  error NO_SESSION en el acto en editcore:chat y agent:run: fuera la clave centinela.
- chat-error-sanitize distingue 401 de sesión («tu sesión expiró: vuelve a iniciar sesión») de
  401/403 de API key; el no-admin cloud ya no recibe el consejo imposible.
- Parcial nunca completo: ai-proxy (supabase/functions/**) emite ante corte del upstream un marco
  SSE de error con partial:true + [DONE] y liquida el cargo; el cliente (ai-core readOpenAiStream)
  marca partial:true ante EOF sin [DONE] con contenido o marco de error; un tool_call con
  argumentos truncados NUNCA se ejecuta con {} (paso marcado toolCallTruncated, la herramienta no
  corre) y el cierre antepone «⚠️ Respuesta parcial». streamedAny interno en provider: un fallo tras
  emitir contenido ya no reenvía el prompt entero (prueba que cuenta peticiones).
- La señal llega al verificador (runVerifier la pasa a runCommand) y runRealVerification mata el
  proceso en curso al abortar (AbortController propio, fuera el Promise.race que abandonaba).
  fetch_stock_photo combina la señal del turno con su timeout y chequea aborto ANTES de escribir:
  turno detenido ⇒ ningún archivo.
- Esperas semánticas con la disciplina del Cerebro: raceSemanticBlock con timeout de 6 s
  (SEMANTIC_MEMORY_TIMEOUT_MS) + chequeo de señal; vencido, el turno arranca sin ese bloque.
- Taxonomía única del 429: runtime/http-error-taxonomy.js (classifyHttpError, parseRetryAfterMs
  con tope declarado de 30 s, isNoSessionError) consumida por provider, model-failover (la
  concurrencia ya NO es cuota: fuera el cooldown de saldo por 429 genérico) y el sanitizador.
DECLARADO (textual del constructor): **el archivo supabase/functions/ai-proxy/index.ts se construye
como código y entra en el paquete, pero su DESPLIEGUE (Edge Function) queda FUERA del paquete: hay
que desplegar la función ai-proxy en el proyecto oficial de Supabase de cuentas por la vía habitual;
hasta que eso ocurra, en producción rige la mitad cliente ya incluida (EOF sin [DONE] ⇒ partial),
que por sí sola ya impide presentar el parcial como completo.** Además: las llamadas HTTP internas
de project-connect no aceptan AbortSignal — la señal corta entre pasos y declara lo ya creado.
Cableado de main ⇒ verificación en vivo (D-1 extendida).
TESTS VIEJOS ACTUALIZADOS: ninguno. Nuevos: test/detener-sesion-b6.test.js (18).

## Bloque 7 — El turno pertenece a su chat; la cola tiene plazo
CONSTRUIDO:
- Helper puro nuevo runtime/chat-turn-ownership.js (UMD, cargado en index.html antes de
  renderer.js): resolveChatDestination (destino = origen; el activo solo es respaldo declarado si
  el origen ya no existe), predicados de visibilidad y de asentado de tarjetas. El renderer lo
  consume en rememberMessage, appendThinking y los guardas de pintado.
- rememberMessage acepta target {projectId, chatId}: persiste contra el chat de ORIGEN en los tres
  llamantes (éxito agente, éxito chat, error) y en los retornos tempranos; persistir en un chat de
  fondo ya no secuestra la vista ni fija activeProjectId ajeno. Pintado solo si el feed del turno
  es visible; si no, la respuesta vive persistida en su chat.
- Tarjetas vivas: stashLiveThinkingCards/reattachThinkingCards + mapa detachedThinkingByChat —
  switchChatThread/createNewChatThread desacoplan los nodos de corridas vivas SIN asentarlos y al
  volver se re-atan LOS MISMOS nodos; la que termina en ausencia no se re-ata (su texto ya está
  persistido: re-atar duplicaría). appendThinking solo asienta tarjetas de su propia corrida/chat.
- Progreso con identidad en ambas rutas: el kernel estampa runId en cada handleChat y emite
  phase:"queued"; el bridge estampa runId/chatId/threadId en CADA evento (emitProgress es la única
  puerta); main fija chatRunId en la ruta chat (antes runId:"") y la ruta agente pasa su runId real;
  el renderer asigna job.runId en ambas rutas y enruta por runId (el fallback «primer thinking»
  queda solo para eventos legados sin runId).
- Cancelar por runId: activeChatRuns pasa a una entrada por corrida; editcore:cancel y
  agent:cancel con {runId, chatId} cancelan SOLO esa corrida (fuera el stopChatKernel()
  incondicional de agent:cancel); sin identificación, el paro global queda como ÚLTIMO RECURSO
  declarado en el código. Kernel: cancelChatRun(runId) — en cola resuelve cancelada sin tocar al
  que corre; en curso aborta solo su señal.
- Plazo de cola: QUEUE_TIMEOUT_MS=120.000 (inyectable; mucho menor que el plazo total del bridge,
  60 min): vencido, el llamante recibe en su burbuja el resultado honesto QUEUED («tu turno sigue
  en cola tras N s… no se ejecutó»). La entrada vencida CONSERVA su sitio en la cadena hasta que le
  toca (liberar antes rompería la serialización intocable) y al llegar no ejecuta y libera.
- Honestidad de la promesa: «N agentes en paralelo (max 4)» → «N turnos activos: el motor ejecuta
  de uno en uno, el resto espera en cola»; el trabajo en cola se etiqueta «en cola (el motor
  ejecuta de uno en uno)» (job.kernelQueued). MAX_PARALLEL_AGENTS=4 se queda como tope de
  lanzamiento de la UI; cambia la verdad de la etiqueta.
DECLARADO: el STOP tecleado (decisión STOP de agent:run y agent:steer) sigue parando el kernel
globalmente — es el comando «detente» en sí, no un handler de cancel. closeChatThread del chat
activo no desacopla tarjetas (ese chat deja de existir; rememberMessage cae al respaldo declarado).
La conducta renderer/main se cierra con la prueba en vivo del bloque.
TESTS VIEJOS ACTUALIZADOS: test/chat-agent-reconstruction.test.js (su aserción certificaba el
cancel global roto cancel({runId:""}); ahora exige la cancelación por runId en ambas rutas).
Nuevos: runtime/chat-turn-ownership.js y test/turno-chat-b7.test.js (7).

## Bloque 8 — Publicación: una sola pila git, evidencia siempre
CONSTRUIDO:
- runtime/git-manager.js REESCRITO sobre git-utils.git (array de argumentos, shell:false,
  lockRetries:2 sin borrar locks jamás): commit con mensaje por -F, filtro de secretos al stagear
  reutilizando la ÚNICA isSecretPath de publish-pipeline (la misma de agent-git), incluida la
  expansión de "." vía status --porcelain -uall con reset de lo ya staged; errores legibles
  («git <args> falló (código N). Salida: …»). tools.js gitCommit/gitPush devuelven
  blockedSecrets/staged y la definición de git_commit expone por fin `files`.
- ssh-deploy.js: fuera los || true (pull y restart como pasos separados; si el pull falla, el
  restart ni se intenta) + humo HTTP obligatorio a la URL del proyecto: ok:true EXIGE humo
  verificado; sin URL ⇒ ok:false con «sin humo: no hay URL», no éxito a secas.
- cloud-vault-bridge.js: deployVercel con deploy fallido ⇒ ok:false con la causa; la URL anterior
  viaja solo como previousUrl y NO se escribe como liveUrl (queda vacía si el deploy falló);
  deployGithub con push fallido o sin remote ⇒ ok:false. fullstack-deploy.js: sin URL nueva ⇒
  deployed:false, etapa live en skipped, previousLiveUrl como dato; nada presenta la vieja como
  recién publicada. Ambas con costuras deps.*Impl para pruebas.
- Humo de deploy-one-click con TERCER ESTADO (solo clasificación; el diseño — reintento,
  firstLogError, orden de claves, camino ≥500 — intacto): ruta principal 401/403/404 ⇒
  verified:false, smokeNotVerified:true, smokeCause («responde un servidor pero no es la app» /
  SSO / WAF), con ok:true del despliegue (NO dispara el rollback de publish-pipeline) y mensaje
  «la publicación NO quedó verificada». 2xx/3xx ⇒ verificado como siempre. Rutas secundarias
  conservan su trato.
- publish-pipeline: el step de deploy conserva smoke/logs (tope declarado
  DEPLOY_EVIDENCE_LOG_CAP=1200)/logsNote/firstLogError/verified/publishFailed en el resumen; el
  resultado de publish_project lleva url (+deployUrl) en la RAÍZ en éxito, fallo y cancelación
  tardía, y el roadmap lee la misma URL. formatExternalActionResult EXPORTADA como costura y
  declara «⚠️ Publicación NO verificada» cuando el humo no verificó.
- Netlify: eliminadas las 3 líneas que borraban netlifyToken/netlifySiteId al guardar/fusionar
  conexiones (main ×2, renderer ×1).
- Esquema deploy_one_click del kernel alineado con extra-tools (provider/production); el viejo
  {target:"vercel"} se traduce en el consumidor con compatibilidad declarada.
DECLARADO: el token de Vercel desde auth.json del CLI en tiempo de deploy (auditoría §10) queda
observado-no-construido (no está en el programa del bloque). El rollback automático ante fallo de
humo no se tocó (y el nuevo estado notVerified deliberadamente no lo dispara).
TESTS VIEJOS ACTUALIZADOS: test/git-manager.test.js (todas las llamadas con await: certificaba la
pila insegura síncrona que convergió). test/publicacion-verificada.test.js pasa SIN cambios.
Nuevos: test/publicacion-b8.test.js (15).

## Bloque 9 — Multiagente y cerebro: reales o fuera
DECISIONES:
- **Fase 8 RETIRADA del camino vivo.** En orchestrator.js el bloque [EDITCORE-PARALLEL] creaba un
  ParallelBatch nuevo por turno, jamás llamaba loadLatest() (rama inalcanzable), sobrescribía
  LATEST.json e inyectaba el prompt del job 1; completeJob/failJob/fanIn tenían 0 llamadores.
  Completar el ciclo no es demostrablemente seguro: los jobs son scopes heurísticos por regex, no
  unidades que el bucle ejecute — no existe mapeo honesto step→job para un fan-in real. Se retiró
  la inyección y el require; runtime/agent-parallel.js queda como módulo de uso explícito.
  **Batches previos en disco: abandono declarado, sin migración** (nadie los leía nunca; desde
  ahora tampoco se sobrescriben).
- **agent-bus deja de escribirse por turno.** Era solo escritura (record/wrapSubagentResult cada
  turno; promptBlock/readMessages/postMessage con 0 llamadores). Leerlo costaría ~2.200
  caracteres/turno del presupuesto del Bloque 2 duplicando el expediente de hechos del Bloque 3.
  El módulo queda para uso explícito (agent-worker.js de TaskQueue lo sigue usando; no es el
  camino vivo del chat).
CONSTRUIDO:
- Locks con ciclo de vida (agent-coordination.js): identidad ÚNICA por corrida = threadId
  (el rol queda como dato informativo); releaseLock corregido (solo libera el dueño-corrida; antes
  la condición dejaba liberar a quien coincidiera solo en rol o solo en thread); renovación de los
  locks de la corrida al adquirir cualquiera y renewThreadLocks como latido SIN temporizadores;
  la purga por TTL sigue para corridas que dejan de trabajar. tools.js: writeFile/replaceInFile
  liberan su lock en CADA salida tras adquirir; latido de renovación en execute();
  acquireWriteLockSet para operaciones compuestas. Identidad única en la práctica: implementer y
  los applyWrite/applyReplace del orquestador usan agentRole:"supervisor" en su coordCtx.
- Vías que escribían sin lock, ahora con lock ANTES de escribir y liberación al terminar:
  scaffold_project (conjunto de sus archivos raíz; si otra corrida retiene uno, falla explicando
  el lock y no escribe nada), install_skill (lock sobre .editcore/skills/<name>), clone_repo
  (carpeta destino), fetch_stock_photo (ruta exacta del archivo, costura inyectada por execute).
- Cerebro unificado en la consulta: brain-service walkProject ya no salta .editcore/rag — walkRag
  indexa los documentos ingeridos en el MISMO índice FTS que searchForAgent lee, con los mismos
  filtros de sensibles/tamaño. La consulta automática (buildCerebroServiceBlock, 6 s/≤3.200
  intactos) ahora ve lo ingerido sin que el modelo llame a search_brain.
- Indexación incremental: searchMemory guarda la huella sha256 por registro y salta los no
  cambiados (2ª búsqueda sin cambios = 0 upserts, medido); _indexUnlocked reutiliza chunks por
  huella mtime:tamaño y solo lee/troza lo nuevo o cambiado.
DECLARADO: run_command sin lock POR NATURALEZA (shell arbitrario; no se finge). La dirección
inversa brainRemember→searchBrainDocs queda fuera (almacenes distintos; search_brain ya compone
ambos buscadores). El código de los repos instalados de la Bodega NO se indexa: exigiría un ámbito
global en el FTS (subsistema nuevo); de un repo solo cruzan catálogo y skills vía read_skill. No se
encontró ninguna promesa de esa búsqueda en la UI (renderer/main/index.html), así que no hubo
línea que corregir.
TESTS VIEJOS ACTUALIZADOS: test/multiagent-parallel.test.js (2 pruebas: asumían el lock retenido
hasta el cierre del turno y la identidad «implementer»; ahora verifican la liberación por escritura
con el invariante entre chats intacto, y la identidad única). Nuevos:
test/multiagente-cerebro-b9.test.js (8).

## Bloque 10 — Fantasmas fuera; la suite prueba el motor que el usuario usa
DECISIÓN (regla del encargo): el adaptador Claude NO se borra — no existe aún una aceptación
contra el kernel que lo sustituya. Vía aplicada: CUARENTENA declarada.
CONSTRUIDO:
- Cuarentena: test-quarantine/claude-adapter/ con README de estado. Movidos enteros (solo
  adaptador): analysis-auth-pause (1), kickoff-briefing (2), reality-filesystem (6),
  model-failover-worker (7) = 16 pruebas. Partidos: los bloques del adaptador de 13 archivos
  salieron como extracted-*.test.js (20 pruebas) y su parte viva se queda en test/ sin importar el
  adaptador. Extracciones dentro de bloque mixto: 7 más que en cuarentena viven como tests propios.
  Total fuera de la suite: 36 bloques de pruebas; la cuarentena ejecutada a mano da 43/43 (las 7
  extracciones cuentan allí como tests propios). runtime/editcore-claude-adapter.js recibe cabecera
  de estado: solo vive en la aceptación headless por argv; no es el motor del producto.
- Se quedan DECLARADOS MIXTOS con nota B10 en cabecera: test/chat-agent-reconstruction.test.js
  (42) y test/conversation-loop.test.js (23) — usan el adaptador como arnés pero cubren módulos
  vivos (ToolDispatcher, agent-parser, AiCore, TaskManager, command-policy, normalizadores,
  ConversationLog, ActionRegistry) sin cobertura equivalente; partirlos es inseguro.
- IPC fantasma (grep de consumidores en renderer/chat-home/index.html/web-portal ANTES de tocar):
  REPARADO auto-tdd — ecosystem:run-tdd y ecosystem:scan-refactor llamaban métodos inexistentes
  (runCycle/scanAndSuggestRefactors, siempre al catch); ahora llaman runTddCycle/
  scanForRefactoring de runtime/auto-tdd-loop.js, que gana así un llamante real.
  RETIRADO con cero llamantes confirmados: handler agent:plan + puente editcoreAgent.plan;
  handler composer:plan + puente editcoreComposer.plan; puente editcoreAsyncAgent + 4 handlers
  async-agent:*; puente editcoreParallelAgents + 5 handlers parallel-agent:*.
  agent:steer: retirada la rama run.adapterInput (inalcanzable: el runState actual no tiene ese
  campo); la vía viva queda intacta. Declarado en el mismo comentario: run.requestController
  tampoco se asigna nunca y su abort posterior es igualmente inalcanzable hoy — se dejó como está
  por ser cambio de conducta fuera de alcance.
  Dejado a propósito y declarado: composer:preview/apply/list (fuera del alcance nombrado);
  activePlanRuns/planRunKey (los consulta agent:cancel; quedan siempre vacíos, no-op inofensivo);
  AGENT_PLAN_TIMEOUT_MS huérfana (solo declaración); async-agent-runner/parallel-agent-runner se
  quedan porque sus tests unitarios los ejercitan directo.
- web-portal/js/web-agent.js: run() ya no pasa onDelta al proveedor — fuera el volcado de deltas
  crudos como narration_delta. La narración web es compuesta (líneas phase:"narration" por paso +
  eventos de herramienta) y la prosa del modelo llega solo como respuesta final. La ruta chat()
  (conversación pura) sigue con sus chunks por su canal propio: no es narración de agente.
- Semilla de aceptación del kernel: scripts/acceptance-kernel.js (NUEVO, fuera de npm test;
  `node scripts/acceptance-kernel.js`, exit 0/1, sin red): camino real bridge→kernel con proveedor
  falso inyectado por helpers.callChat y proyecto temporal — turno 1 crea notas.txt real en disco
  vía write_file del kernel; turno 2, sin nombrar el archivo, lo recuerda desde el expediente.
  Resultado verificado por el coordinador: PASS. Es el embrión de la aceptación que un día permita
  borrar el adaptador.
- Migración de tests por riesgo: permisos/«procede» ya cubierto por comportamiento en B5 y
  publicación en B8 (anotado como «la prueba que manda» en no-regression-contracts);
  test/projectless-rebind.test.js y test/projectless-workspace.test.js se quedan como vigilancia
  estructural secundaria con nota B10 en el propio test (la guarda projectless es clausura del
  renderer sin costura pura; el comportamiento que manda: projectless-chat y turno-chat-b7); la
  mitad viva del «walker cobertura» de analysis-pipeline-contract se reescribió como
  comportamiento contra resolveAnalysisDepth (+1 prueba, la única que sube el total en este bloque).
- Huérfanos declarados, NO borrados: runtime/auto-fix-loop.js y runtime/agent-memory.js
  (AgentMemory) — su único consumidor era el adaptador en cuarentena; el kernel no los importa.
DECLARADO: la convergencia completa web↔kernel queda fuera (solo paridad de narración). La
aceptación completa contra el kernel que sustituya a la headless del adaptador queda como semilla
(scripts/acceptance-kernel.js), no como sustituto terminado: por eso el adaptador se cuarentena y
no se borra.
TESTS VIEJOS ACTUALIZADOS: los 13 archivos partidos (su parte del adaptador salió a cuarentena),
test/chat-agent-reconstruction.test.js (la prueba del planificador ahora afirma la retirada del
handler/puente sin llamantes), test/web-cuentas.test.js (afirma la ausencia de narration_delta
crudo y la presencia de la narración compuesta), y notas B10 en chat-agent-reconstruction,
conversation-loop, no-regression-contracts, projectless-rebind y projectless-workspace.

---

## Archivos del paquete por tipo
- Código del producto modificado: brain-service.js; editcore-chat-kernel/{classify,
  context-compactor, extra-tools, forensic-checks, index, orchestrator, parse-text-tools,
  process-runner, provider, repair-guard, skills-catalog, snapshot, stock-photos, tools}.js;
  editcore-chat-kernel/subagents/{implementer, verifier}.js; editcore-chat-kernel/{thread-core,
  thread-memory}.js; index.html; main.js; preload.js; renderer.js; runtime/{agent-coordination,
  ai-core, chat-error-sanitize, chat-kernel-bridge, cloud-vault-bridge, deploy-one-click,
  editcore-claude-adapter (solo cabecera), fullstack-deploy, git-manager, model-failover,
  project-connect, publish-pipeline, skills-engine, ssh-deploy}.js;
  supabase/functions/ai-proxy/index.ts; web-portal/js/web-agent.js; .vercelignore.
- Código NUEVO: runtime/chat-turn-ownership.js (B7), runtime/http-error-taxonomy.js (B6),
  scripts/acceptance-kernel.js (B10).
- Pruebas NUEVAS en test/: verdad-turno-b1 (7), economia-contexto-b2 (9), memoria-hechos-b3 (6),
  herramientas-evidencia-b4 (14), permisos-flujo-b5 (12), detener-sesion-b6 (18), turno-chat-b7 (7),
  publicacion-b8 (15), multiagente-cerebro-b9 (8) = 96 pruebas de comportamiento nuevas en los
  Bloques 1-9, más 1 reescrita en el Bloque 10.
- Pruebas actualizadas a propósito: repair-guard (B1), permission-modes-kernel (B5, solo cabecera),
  chat-agent-reconstruction (B7 y B10), git-manager (B8), multiagent-parallel (B9), web-cuentas
  (B10), los 13 partidos y los anotados del B10.
- Cuarentena (fuera de la suite): test-quarantine/claude-adapter/ — README + 4 archivos movidos +
  21 extracted-*.test.js.
- MOVIMIENTO que el paquete no puede expresar como reemplazo: los 4 archivos movidos SALEN de
  test/ (analysis-auth-pause, kickoff-briefing, reality-filesystem, model-failover-worker) — en el
  paquete viven ya en test-quarantine/claude-adapter/; al aplicar hay que borrar sus copias viejas
  de test/ (instrucción expresa en el LEEME y en el prompt de aplicación).
