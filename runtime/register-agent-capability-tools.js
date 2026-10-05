"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ProjectDiscovery } = require("./project-discovery");
const { CodebaseMap } = require("./codebase-map");
const { inspectBrowser } = require("./browser-inspector");
const { listTools: mcpListTools, invokeTool: mcpInvokeTool } = require("./mcp-bridge");
const { unifiedSearch } = require("./unified-search");
const { planDiagnostics, runDiagnostics } = require("./post-write-diagnostics");
const { semanticSearch } = require("./semantic-index");
const { registerBuiltinMultimodalTools } = require("./tool-dispatcher");
const { runParallelExplore, runSubagent } = require("./subagent-runner");
const { browserInteract } = require("./browser-interact");
const { proposeDiff, applyDiff } = require("./diff-preview");
const { deployOneClick } = require("./deploy-one-click");

const projectDiscovery = new ProjectDiscovery();
const codebaseMap = new CodebaseMap();

function registerAgentCapabilityTools(dispatcher, {
  rootPath,
  canWrite = false,
  event = null,
  BrowserWindow = null,
  capturePreview = null,
  startProjectPreview = null,
  readConnections = null,
  executeRemoteTool = null,
  connectionSummary = null,
  getOperatorConnectionsSnapshot = null,
  connectGatewayProject = null,
  getGatewayAdminToken = null,
  appUserData = "",
  brain = null,
  runProjectCommand = null,
  writeProjectFile = null,
  visionGenerate = null,
} = {}) {
  if (!dispatcher || !rootPath) return dispatcher;

  dispatcher.register({
    name: "project_discovery",
    description: "Detecta stack, scripts, entrypoints y configuracion real del proyecto.",
    execute: async (toolInput = {}) => projectDiscovery.discover(rootPath, { refresh: toolInput.refresh === true }),
  });

  dispatcher.register({
    name: "codebase_map",
    description: "Mapa estructural de archivos, modulos, simbolos, imports y exports.",
    execute: async (toolInput = {}) => {
      const map = codebaseMap.build(rootPath, { refresh: toolInput.refresh === true });
      if (toolInput.includeFiles === false) {
        return {
          ...map,
          files: map.files?.slice(0, 120).map(({ symbols, imports, exports, ...file }) => ({
            ...file,
            symbolCount: symbols?.length || 0,
            importCount: imports?.length || 0,
            exportCount: exports?.length || 0,
          })) || [],
        };
      }
      return map;
    },
  });

  dispatcher.register({
    name: "symbol_search",
    description: "Busca funciones, clases, componentes, hooks y tipos por nombre.",
    execute: async (toolInput = {}) => {
      const query = String(toolInput.query || "").trim();
      if (!query) throw new Error("symbol_search requiere query.");
      return codebaseMap.searchSymbols(rootPath, query, {
        kinds: Array.isArray(toolInput.kinds) ? toolInput.kinds : [],
        pathPrefix: String(toolInput.path || ""),
        limit: Number(toolInput.limit) || 30,
      });
    },
  });

  dispatcher.register({
    name: "dependency_search",
    description: "Busca imports, exports y referencias de modulos.",
    execute: async (toolInput = {}) => {
      const query = String(toolInput.query || "").trim();
      if (!query) throw new Error("dependency_search requiere query.");
      return codebaseMap.searchDependencies(rootPath, query, {
        pathPrefix: String(toolInput.path || ""),
        limit: Number(toolInput.limit) || 40,
      });
    },
  });

  dispatcher.register({
    name: "search",
    description: "Busqueda unificada en archivos del proyecto y conocimiento del Cerebro.",
    execute: async (toolInput = {}) => unifiedSearch({
      projectRoot: rootPath,
      query: toolInput.query,
      pathPrefix: toolInput.path || "",
      limit: Number(toolInput.limit) || 20,
      brain,
    }),
  });

  dispatcher.register({
    name: "run_diagnostics",
    description: "Ejecuta typecheck/lint descubiertos en package.json sobre archivos cambiados.",
    execute: async (toolInput = {}) => {
      const files = Array.isArray(toolInput.files) ? toolInput.files.map(String) : [];
      if (!runProjectCommand) return planDiagnostics(rootPath, files);
      return runDiagnostics(rootPath, files, {
        runCommand: (command) => runProjectCommand(rootPath, command, "analysis"),
      });
    },
  });

  dispatcher.register({
    name: "mcp_list_tools",
    description: "Lista tools MCP. Config global automatica de EDITCOREAI; override opcional en .editcore/mcp.json. Solo arranca procesos al consultar.",
    execute: async () => mcpListTools(rootPath, { userDataPath: appUserData }),
  });

  dispatcher.register({
    name: "mcp_invoke",
    description: "Invoca tool MCP allowlisted bajo demanda (lazy). Sin servidores: responde idle sin romper.",
    execute: async (toolInput = {}) => mcpInvokeTool(rootPath, toolInput, { userDataPath: appUserData }),
  });

  dispatcher.register({
    name: "semantic_search",
    description: "Busqueda semantica local (TF-IDF) con Qdrant opcional si .editcore/qdrant.json existe.",
    execute: async (toolInput = {}) => semanticSearch(rootPath, toolInput.query, {
      limit: Number(toolInput.limit) || 12,
      refresh: toolInput.refresh === true,
    }),
  });

  dispatcher.register({
    name: "run_parallel_explore",
    description: "Lanza sub-agentes de solo lectura en paralelo (search + semantic) y fusiona evidencia.",
    execute: async (toolInput = {}) => runParallelExplore(rootPath, toolInput, { brain }),
  });

  dispatcher.register({
    name: "run_subagent",
    description: "Sub-agente acotado. role=explorer (lectura) o implementer (max 5 patches locales, sin secretos).",
    write: canWrite,
    execute: async (toolInput = {}) => runSubagent(rootPath, toolInput, {
      brain,
      applyWrite: canWrite
        ? async (rel, content) => {
            const full = path.join(rootPath, ...String(rel).split("/"));
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, String(content ?? ""), "utf8");
            return { path: rel };
          }
        : null,
      applyReplace: canWrite
        ? async (rel, oldText, newText, replaceAll = false) => {
            const full = path.join(rootPath, ...String(rel).split("/"));
            const current = fs.readFileSync(full, "utf8");
            if (!current.includes(String(oldText))) throw new Error("oldText no encontrado.");
            const next = replaceAll
              ? current.split(String(oldText)).join(String(newText))
              : current.replace(String(oldText), String(newText));
            fs.writeFileSync(full, next, "utf8");
            return { path: rel };
          }
        : null,
    }),
  });

  if (canWrite) {
    registerBuiltinMultimodalTools(dispatcher, { rootPath, canWrite: true });

    dispatcher.register({
      name: "add_erp_module",
      write: true,
      description: "Inyecta un modulo ERP (inventory|payroll|invoicing|crm) con migracion SQL primero y CRUD UI sin sobrescribir nav/conexiones core.",
      schema: {
        type: "object",
        properties: {
          module: { type: "string", enum: ["inventory", "payroll", "invoicing", "crm"] },
          name: { type: "string" },
        },
        required: ["module"],
      },
      execute: async (toolInput = {}) => {
        const { addErpModule } = require("./enterprise-erp");
        return addErpModule(rootPath, toolInput.module || toolInput.name || "");
      },
    });

    dispatcher.register({
      name: "propose_diff",
      write: false,
      description: "Propone un cambio y devuelve diff unificado + hunks sin escribir. Luego apply_diff.",
      execute: async (toolInput = {}) => proposeDiff(rootPath, toolInput),
    });

    dispatcher.register({
      name: "propose_diff_batch",
      write: false,
      description: "Propone varios diffs multi-archivo (files[{path,content|oldText/newText}]).",
      execute: async (toolInput = {}) => {
        const { proposeDiffBatch } = require("./diff-preview");
        return proposeDiffBatch(rootPath, toolInput.files || toolInput.changes || []);
      },
    });

    dispatcher.register({
      name: "apply_diff",
      write: true,
      description: "Aplica un propose_diff por proposalId.",
      execute: async (toolInput = {}) => applyDiff(rootPath, toolInput, {
        writeFile: (rel, content) => {
          if (typeof writeProjectFile === "function") {
            return writeProjectFile(rel, content);
          }
          const full = path.join(rootPath, ...String(rel).split("/"));
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, String(content ?? ""), "utf8");
          return { path: rel, backupPath: "", created: true };
        },
      }),
    });

    dispatcher.register({
      name: "migration_playbook",
      write: true,
      description: "Aplica playbook de migracion (js-to-ts|react-hooks|orm-prisma).",
      execute: async (toolInput = {}) => {
        const { applyMigrationPlaybook, listMigrationPlaybooks, runMigrationBatch, rollbackMigrationBatch } = require("./migration-playbooks");
        if (toolInput.list === true) return { playbooks: listMigrationPlaybooks() };
        if (toolInput.rollback === true || toolInput.action === "rollback") {
          return rollbackMigrationBatch(rootPath, toolInput.runId || toolInput.id);
        }
        if (Array.isArray(toolInput.batch) && toolInput.batch.length) {
          return runMigrationBatch(rootPath, toolInput);
        }
        return applyMigrationPlaybook(rootPath, toolInput.playbook || toolInput.id || "");
      },
    });

    dispatcher.register({
      name: "run_tdd_cycle",
      write: true,
      description: "Ciclo TDD: escribe test/fixture opcional, corre tests, indica si hay que corregir codigo.",
      execute: async (toolInput = {}) => {
        const { runTddCycle } = require("./tdd-cycle");
        return runTddCycle(rootPath, toolInput, {
          runCommand: runProjectCommand
            ? (command) => runProjectCommand(rootPath, command, "analysis")
            : undefined,
        });
      },
    });

    dispatcher.register({
      name: "run_test_repair_loop",
      write: true,
      description: "Bucle autónomo: ejecuta tests, aplica parches (applyPatch) y reintenta hasta verde.",
      execute: async (toolInput = {}) => {
        const { runTddRepair } = require("./test-repair-loop");
        return runTddRepair(rootPath, {
          testCommand: toolInput.testCommand || toolInput.command || "",
          maxAttempts: Number(toolInput.maxAttempts) || 3,
          patches: Array.isArray(toolInput.patches) ? toolInput.patches : [],
          runCommand: runProjectCommand
            ? (command) => runProjectCommand(rootPath, command, "analysis")
            : undefined,
        });
      },
    });

    dispatcher.register({
      name: "export_session",
      write: true,
      description: "Exporta hilo de chat/Composer a .editcore/sessions/*.md para compartir con el equipo.",
      execute: async (toolInput = {}) => {
        const { exportSession } = require("./session-export");
        return exportSession(rootPath, toolInput);
      },
    });

    dispatcher.register({
      name: "rename_sync",
      write: true,
      description: "Renombra archivo (from/to) o simbolo TS (kind=symbol, file, oldName, newName) y actualiza referencias.",
      execute: async (toolInput = {}) => {
        const { renameSyncFile, renameSyncSymbol } = require("./rename-sync");
        if (toolInput.kind === "symbol" || toolInput.oldName || toolInput.fromSymbol) {
          return renameSyncSymbol(rootPath, toolInput);
        }
        return renameSyncFile(rootPath, toolInput.from || toolInput.path, toolInput.to || toolInput.newPath, {
          dryRun: toolInput.dryRun === true,
          updateRefs: toolInput.updateRefs !== false,
        });
      },
    });

    dispatcher.register({
      name: "images_to_code",
      write: true,
      description: "Genera UI desde brief/imagen. Con modelo vision + images[] usa LLM; si no, scaffold local.",
      execute: async (toolInput = {}) => {
        const { imagesToCode } = require("./images-to-code");
        return await imagesToCode(rootPath, toolInput, {
          visionGenerate: typeof visionGenerate === "function" ? visionGenerate : undefined,
          model: toolInput.model || "",
        });
      },
    });

    dispatcher.register({
      name: "clone_web_page",
      write: true,
      description: "Clona una URL externa: render DOM (Puppeteer/Playwright), capturas, visión→React/Tailwind y merge en golden template. Input: url, replacements{}, title, folder, viewport, skipVision, mergeApp.",
      execute: async (toolInput = {}) => {
        const { cloneWebPage } = require("./clone-web-page");
        return await cloneWebPage(rootPath, toolInput, {
          visionGenerate: typeof visionGenerate === "function" ? visionGenerate : undefined,
          model: toolInput.model || "",
        });
      },
    });

    dispatcher.register({
      name: "run_e2e_pipeline",
      write: true,
      description: "Ejecuta verificación end-to-end 1→100 (visión, clone, brain, IPC, tools) y guarda .editcore/e2e-pipeline-report.md con el mismo formato de reporte.",
      execute: async (toolInput = {}) => {
        const { runEditcoreE2ePipeline } = require("./e2e-pipeline-report");
        return runEditcoreE2ePipeline(rootPath, {
          writeReport: toolInput.writeReport !== false,
        });
      },
    });

    dispatcher.register({
      name: "auto_docs",
      write: true,
      description: "Genera docs/AUTO_README.md y docs/AUTO_API.md del proyecto.",
      execute: async () => {
        const { generateAutoDocs } = require("./auto-docs");
        return generateAutoDocs(rootPath, { write: true });
      },
    });

  dispatcher.register({
    name: "docker_playbook",
    write: true,
    description: "Aplica playbook Docker (node|static) bajo .editcore/playbooks/docker.",
    execute: async (toolInput = {}) => {
      const { applyDockerPlaybook, listDockerPlaybooks } = require("./docker-playbooks");
      if (toolInput.list === true) return { playbooks: listDockerPlaybooks() };
      return applyDockerPlaybook(rootPath, toolInput.playbook || toolInput.id || "node");
    },
  });
  }

  dispatcher.register({
    name: "audit_dead_code",
    description: "Auditoria de exports huerfanos y archivos posiblemente sin uso.",
    execute: async (toolInput = {}) => {
      const { auditDeadCode } = require("./dead-code-audit");
      return auditDeadCode(rootPath, { limit: Number(toolInput.limit) || 40 });
    },
  });

  dispatcher.register({
    name: "audit_sql_performance",
    description: "Heuristica de consultas N+1 / queries en loops.",
    execute: async (toolInput = {}) => {
      const { auditSqlPerformance } = require("./dead-code-audit");
      return auditSqlPerformance(rootPath, { limit: Number(toolInput.limit) || 20 });
    },
  });

  dispatcher.register({
    name: "tail_logs",
    description: "Lee las ultimas lineas del log de preview/dev (.editcore/preview.log).",
    execute: async (toolInput = {}) => {
      const { tailLog } = require("./log-tail");
      return tailLog(rootPath, toolInput);
    },
  });

  dispatcher.register({
    name: "list_workflows",
    description: "Lista workflows reproducibles en .editcore/workflows.",
    execute: async (toolInput = {}) => {
      const { listWorkflows, ensureWorkflowScaffold } = require("./project-rules-workflows");
      if (toolInput.ensure === true) ensureWorkflowScaffold(rootPath);
      return { workflows: listWorkflows(rootPath) };
    },
  });

  dispatcher.register({
    name: "run_workflow",
    description: "Ejecuta un workflow de .editcore/workflows (read_file / run_command).",
    execute: async (toolInput = {}) => {
      const { runWorkflow } = require("./project-rules-workflows");
      return runWorkflow(rootPath, toolInput.id || toolInput.workflow || toolInput.name, {
        runCommand: runProjectCommand
          ? (command) => runProjectCommand(rootPath, command, "analysis")
          : undefined,
      });
    },
  });

  dispatcher.register({
    name: "git_status",
    description: "Estado git corto + rama actual.",
    execute: async () => {
      const { gitStatus, gitDiffStat } = require("./agent-git");
      return { ...gitStatus(rootPath), diff: gitDiffStat(rootPath) };
    },
  });

  if (canWrite) {
    dispatcher.register({
      name: "git_create_branch",
      write: true,
      description: "Crea (y opcionalmente hace checkout) de una rama git.",
      execute: async (toolInput = {}) => {
        const { gitCreateBranch } = require("./agent-git");
        return gitCreateBranch(rootPath, toolInput.branch || toolInput.name, {
          checkout: toolInput.checkout !== false,
        });
      },
    });
    dispatcher.register({
      name: "git_commit",
      write: true,
      description: "Commit git con mensaje (addPaths opcional).",
      execute: async (toolInput = {}) => {
        const { gitCommit } = require("./agent-git");
        return gitCommit(rootPath, toolInput.message || toolInput.msg, {
          addPaths: toolInput.paths || toolInput.addPaths || [],
        });
      },
    });
    dispatcher.register({
      name: "git_pull",
      write: true,
      description: "git pull desde remote/branch.",
      execute: async (toolInput = {}) => {
        const { gitPull } = require("./agent-git");
        return gitPull(rootPath, toolInput);
      },
    });
    dispatcher.register({
      name: "git_push",
      write: true,
      description: "git push a remote/branch.",
      execute: async (toolInput = {}) => {
        const { gitPush } = require("./agent-git");
        return gitPush(rootPath, toolInput);
      },
    });
    dispatcher.register({
      name: "docker_compose",
      write: true,
      description: "docker compose up|down|build|ps; logs con action=logs.",
      execute: async (toolInput = {}) => {
        const { runDockerCompose, dockerComposeLogs } = require("./docker-playbooks");
        if (String(toolInput.action || "") === "logs") {
          return dockerComposeLogs(rootPath, toolInput);
        }
        return runDockerCompose(rootPath, toolInput);
      },
    });
  }

  dispatcher.register({
    name: "deploy_one_click",
    write: canWrite,
    description: "Deploy one-click a Vercel o Netlify con tokens de Conexiones (cuenta personal, sin SaaS de pago de EDITCOREAI).",
    execute: async (toolInput = {}) => {
      const connections = typeof readConnections === "function" ? readConnections() : {};
      return deployOneClick(rootPath, toolInput, { connections });
    },
  });

  if (canWrite) {
    const { publishProject } = require("./publish-pipeline");
    const { connectProject, assessProjectConnections } = require("./project-connect");
    const { provisionProject } = require("./project-provision");
    const { onboardProject } = require("./project-onboarding");
    const { createSupabaseProject } = require("./supabase-provision");
    const { syncEnvToVercel } = require("./vercel-env-sync");
    const { manageSupabaseProject } = require("./supabase-manager");
    const { sshDeploy } = require("./ssh-deploy");
    dispatcher.register({
      name: "publish_project",
      write: true,
      description: "Publicacion deterministica: branch actual, commit sin secretos, push, supabase db push si aplica, deploy_one_click. mode=project|editcore.",
      execute: async (toolInput = {}) => {
        const connections = typeof readConnections === "function" ? readConnections() : {};
        return publishProject(rootPath, {
          mode: String(toolInput.mode || "project"),
          connections,
          deploy: toolInput.deploy !== false,
          supabasePush: toolInput.supabasePush !== false,
          commitMessage: String(toolInput.commitMessage || ""),
          skipPush: toolInput.skipPush === true,
        });
      },
    });
    dispatcher.register({
      name: "fullstack_deploy",
      write: true,
      description: "Pipeline 1 clic: GitHub repo → Vercel env sync → Supabase/.env → commit/push/deploy → project-infra.json. Usa bóveda Conexiones.",
      execute: async (toolInput = {}) => {
        const { executeFullStackDeploy } = require("./fullstack-deploy");
        const connections = typeof readConnections === "function" ? readConnections() : {};
        return executeFullStackDeploy(rootPath, connections, {
          repoName: String(toolInput.repoName || ""),
          commitMessage: String(toolInput.commitMessage || ""),
          skipDeploy: toolInput.skipDeploy === true,
          skipPreCheck: toolInput.skipPreCheck === true,
          rollbackOnFail: toolInput.rollbackOnFail !== false,
        });
      },
    });
    dispatcher.register({
      name: "connect_project",
      write: true,
      description: "Enlaza el proyecto actual a GitHub/Vercel/Supabase usando Conexiones globales de EDITCOREAI. Crea remote/repo/env local si faltan.",
      execute: async (toolInput = {}) => {
        const connections = typeof readConnections === "function" ? readConnections() : {};
        return connectProject(rootPath, connections, {
          createGithub: toolInput.createGithub !== false,
          createVercel: toolInput.createVercel !== false,
          linkSupabase: toolInput.linkSupabase !== false,
          repoName: String(toolInput.repoName || ""),
        });
      },
    });
    dispatcher.register({
      name: "assess_project_connections",
      write: false,
      description: "Diagnostica que falta para publicar (git remote, tokens, supabase, vercel).",
      execute: async () => {
        const connections = typeof readConnections === "function" ? readConnections() : {};
        return assessProjectConnections(rootPath, connections);
      },
    });
    dispatcher.register({
      name: "onboard_project",
      write: true,
      description: "Onboard proyecto nuevo: npm install, Supabase (supabase/), GitHub, Vercel, envs, proveedor de IA. Usar tras create_project o proyecto recien creado.",
      execute: async (toolInput = {}) => {
        const connections = typeof readConnections === "function" ? readConnections() : {};
        return onboardProject(rootPath, connections, {
          localProjectId: String(toolInput.localProjectId || ""),
          projectName: String(toolInput.projectName || path.basename(rootPath)),
          installDeps: toolInput.installDeps !== false,
          bootstrapSupabase: toolInput.bootstrapSupabase !== false,
          connectServices: toolInput.connectServices !== false,
          connectGateway: false,
          firstDeploy: toolInput.firstDeploy === true,
          initialBalanceUsd: Number(toolInput.initialBalanceUsd) || 0,
          adminToken: String(toolInput.adminToken || ""),
          repoName: String(toolInput.repoName || ""),
          connectGatewayProject: null,
        });
      },
    });
    dispatcher.register({
      name: "provision_project",
      write: true,
      description: "Aprovisionamiento completo: conectar GitHub/Vercel/Supabase, sync envs Vercel, gestionar Supabase, validar y opcionalmente publicar.",
      execute: async (toolInput = {}) => {
        const connections = typeof readConnections === "function" ? readConnections() : {};
        return provisionProject(rootPath, connections, {
          repoName: String(toolInput.repoName || ""),
          syncVercel: toolInput.syncVercel !== false,
          manageSupabase: toolInput.manageSupabase !== false,
          validateBeforePublish: toolInput.validateBeforePublish !== false,
          firstDeploy: toolInput.firstDeploy === true,
          sshAfterPublish: toolInput.sshAfterPublish === true,
          commitMessage: String(toolInput.commitMessage || ""),
        });
      },
    });
    dispatcher.register({
      name: "project_health",
      write: false,
      description: "Estado de salud del proyecto: git, remote, migraciones, ultima publicacion.",
      execute: async () => {
        const connections = typeof readConnections === "function" ? readConnections() : {};
        const { checkProjectHealth } = require("./project-maintainer");
        return checkProjectHealth(rootPath, connections);
      },
    });
    dispatcher.register({
      name: "deploy_github",
      write: true,
      description: "Crea/enlaza remote GitHub y push usando token de la bóveda Conexiones (sin exponer secretos).",
      execute: async (toolInput = {}) => {
        const bridge = require("./cloud-vault-bridge").createCloudVaultBridge({
          getConnections: typeof readConnections === "function" ? readConnections : () => ({}),
        });
        return bridge.deployGithub(rootPath, toolInput);
      },
    });
    dispatcher.register({
      name: "deploy_vercel",
      write: true,
      description: "Enlaza Vercel, sync envs y deploy con token de bóveda.",
      execute: async (toolInput = {}) => {
        const bridge = require("./cloud-vault-bridge").createCloudVaultBridge({
          getConnections: typeof readConnections === "function" ? readConnections : () => ({}),
        });
        return bridge.deployVercel(rootPath, toolInput);
      },
    });
    dispatcher.register({
      name: "provision_supabase",
      write: true,
      description: "Provisiona/enlaza Supabase del proyecto con credenciales de bóveda.",
      execute: async (toolInput = {}) => {
        const bridge = require("./cloud-vault-bridge").createCloudVaultBridge({
          getConnections: typeof readConnections === "function" ? readConnections : () => ({}),
        });
        return bridge.provisionSupabase(rootPath, toolInput);
      },
    });
    dispatcher.register({
      name: "provision_gafcore_ai",
      write: false,
      description: "Deprecado. Elige un modelo en el panel Modelos.",
      execute: async () => {
        throw new Error("Esta integración ya no está disponible. Elige un modelo en el panel Modelos.");
      },
    });
    dispatcher.register({
      name: "provision_fullstack_project",
      write: true,
      description: "Orquestador 1 clic: GitHub + Vercel + Supabase + project-infra.json (bóveda).",
      execute: async (toolInput = {}) => {
        const bridge = require("./cloud-vault-bridge").createCloudVaultBridge({
          getConnections: typeof readConnections === "function" ? readConnections : () => ({}),
        });
        return bridge.provisionFullStackProject(rootPath, toolInput);
      },
    });
    dispatcher.register({
      name: "create_supabase_project",
      write: true,
      description: "Crea/enlaza Supabase en el proyecto: bootstrap supabase/, env, bucket, db push. useCloud opcional.",
      execute: async (toolInput = {}) => {
        const connections = typeof readConnections === "function" ? readConnections() : {};
        return createSupabaseProject(rootPath, connections, {
          projectName: String(toolInput.projectName || ""),
          useCloud: toolInput.useCloud === true,
          bucketName: String(toolInput.bucketName || "uploads"),
          pushDb: toolInput.pushDb !== false,
        });
      },
    });
    dispatcher.register({
      name: "sync_vercel_env",
      write: true,
      description: "Sincroniza variables de .env.local a Vercel (sin commitear secretos).",
      execute: async (toolInput = {}) => {
        const connections = typeof readConnections === "function" ? readConnections() : {};
        return syncEnvToVercel(rootPath, connections, {
          projectId: String(toolInput.projectId || ""),
          projectName: String(toolInput.projectName || ""),
        });
      },
    });
    dispatcher.register({
      name: "supabase_manage",
      write: true,
      description: "Verifica Supabase, drift de migraciones y bucket storage opcional.",
      execute: async (toolInput = {}) => {
        const connections = typeof readConnections === "function" ? readConnections() : {};
        return manageSupabaseProject(rootPath, connections, {
          ensureBucket: toolInput.ensureBucket !== false,
          bucketName: String(toolInput.bucketName || "uploads"),
        });
      },
    });
    dispatcher.register({
      name: "ssh_deploy",
      write: true,
      description: "Deploy remoto por SSH: git pull + reinicio en servidor configurado.",
      execute: async (toolInput = {}) => {
        const connections = typeof readConnections === "function" ? readConnections() : {};
        return sshDeploy(rootPath, connections, {
          remotePath: String(toolInput.remotePath || ""),
          restartCommand: String(toolInput.restartCommand || ""),
        });
      },
    });
  }

  if (readConnections && connectionSummary) {
    dispatcher.register({
      name: "connection_status",
      description: "Consulta conexiones del operador (GitHub, Vercel, Supabase, SSH, modelos de IA) sin secretos.",
      execute: async (toolInput = {}) => {
        if (typeof getOperatorConnectionsSnapshot === "function") {
          const snapshot = getOperatorConnectionsSnapshot();
          const service = String(toolInput.service || "").toLowerCase();
          if (!service) return snapshot;
          if (service === "ai" || service === "meai" || service === "apicredits" || service === "models") {
            return { aiProvider: snapshot.aiProvider || { configured: false, label: "Modelos de IA" } };
          }
          return { [service]: snapshot[service] || { configured: false } };
        }
        const summary = connectionSummary(readConnections());
        const service = String(toolInput.service || "").toLowerCase();
        return service ? { [service]: summary[service] || { configured: false } } : summary;
      },
    });
  }

  if (executeRemoteTool) {
    dispatcher.register({
      name: "service_read",
      description: "Lee datos de un servicio conectado (GET/HEAD).",
      execute: async (toolInput = {}) => executeRemoteTool({
        service: toolInput.service,
        method: toolInput.method || "GET",
        path: toolInput.path || "/",
        body: toolInput.body,
        projectRoot: rootPath,
      }),
    });

    if (canWrite) {
      dispatcher.register({
        name: "service_write",
        write: true,
        description: "Modifica un servicio conectado (POST/PATCH/PUT/DELETE).",
        execute: async (toolInput = {}) => executeRemoteTool({
          service: toolInput.service,
          method: toolInput.method || "POST",
          path: toolInput.path || "/",
          body: toolInput.body,
          projectRoot: rootPath,
        }),
      });
    }
  }

  if (BrowserWindow && capturePreview && startProjectPreview && event) {
    dispatcher.register({
      name: "inspect_preview",
      description: "Inicia y examina visualmente el preview local del proyecto.",
      execute: async (toolInput = {}) => {
        const preview = await startProjectPreview(rootPath, event.sender.id);
        if (!preview?.available || !preview.url) {
          throw new Error(String(preview?.message || preview?.reason || "Preview no disponible."));
        }
        const outputRoot = path.join(String(appUserData || ""), "preview-inspections", path.basename(rootPath));
        fs.mkdirSync(outputRoot, { recursive: true });
        const result = await capturePreview({
          BrowserWindow,
          url: preview.url,
          viewport: toolInput.viewport || "desktop",
          outputRoot,
        });
        return { ...result, previewUrl: preview.url };
      },
    });

    dispatcher.register({
      name: "inspect_browser",
      description: "Inspecciona el preview local (solo localhost). Opcional: url local del preview.",
      execute: async (toolInput = {}) => inspectBrowser({
        BrowserWindow,
        startProjectPreview,
        rootPath,
        senderId: event.sender.id,
        appUserData,
        url: toolInput.url || "",
        viewport: toolInput.viewport || "desktop",
      }),
    });

    dispatcher.register({
      name: "browser_interact",
      description: "Interactua con el preview local: dom, console, click, type, scroll, wait_for, screenshot, reload, close. Solo localhost.",
      execute: async (toolInput = {}) => browserInteract(toolInput, {
        BrowserWindow,
        startProjectPreview,
        rootPath,
        senderId: event.sender.id,
        appUserData,
      }),
    });
  }

  // Register Agent Tools Suite for Full Project Scaffolding, Process & Health Management
  const suite = require("./agent-tools-suite");

  if (canWrite) {
    dispatcher.register({
      name: "write_file_batch",
      write: true,
      description: "Escribe de forma atomica multiples archivos (files: [{path, content}]) en el proyecto.",
      execute: async (toolInput = {}) => suite.writeFileBatch(rootPath, toolInput.files || toolInput.items || []),
    });

    dispatcher.register({
      name: "scaffold_project",
      write: true,
      description: "Crea estructura completa de proyecto Greenfield. Plantillas: vite-react-ts, nextjs-fullstack, fastapi-python, express-ts, fullstack-next-fastapi.",
      execute: async (toolInput = {}) => suite.scaffoldProject(rootPath, toolInput),
    });

    dispatcher.register({
      name: "manage_dependencies",
      write: true,
      description: "Gestor de dependencias npm, pip, bun. Acciones: install, add, remove.",
      execute: async (toolInput = {}) => suite.manageDependencies(rootPath, toolInput),
    });

    dispatcher.register({
      name: "orchestrate_project_build",
      write: true,
      description: "Orquestador guiado de creacion y desarrollo de proyectos end-to-end.",
      execute: async (toolInput = {}) => suite.orchestrateProjectBuild(rootPath, toolInput),
    });
  }

  dispatcher.register({
    name: "manage_process",
    write: canWrite,
    description: "Gestor de servidores de desarrollo y procesos en segundo plano. Acciones: start, status, logs, stop, list.",
    execute: async (toolInput = {}) => suite.manageProcess(rootPath, toolInput),
  });

  dispatcher.register({
    name: "verify_project_health",
    write: false,
    description: "Verifica integridad, sintaxis TypeScript/Python, manifest de dependencias y estado de salud del proyecto.",
    execute: async (toolInput = {}) => suite.verifyProjectHealth(rootPath, toolInput),
  });

  dispatcher.register({
    name: "probe_endpoint",
    description: "Prueba health HTTP de loopback o del endpoint del proveedor de modelos (diagnóstico).",
    execute: async (toolInput = {}) => {
      const { probeEndpoint } = require("./probe-endpoint");
      return probeEndpoint(toolInput);
    },
  });
  dispatcher.register({
    name: "test_local_api",
    description: "Atajo: GET http://127.0.0.1:<port><path> para verificar servicios locales.",
    execute: async (toolInput = {}) => {
      const { testLocalApi } = require("./probe-endpoint");
      return testLocalApi(toolInput);
    },
  });

  return dispatcher;
}

module.exports = { registerAgentCapabilityTools, projectDiscovery, codebaseMap };

