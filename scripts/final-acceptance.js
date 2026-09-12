"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { ProjectScaffoldService } = require("../project-scaffold-service");

const appRoot = path.resolve(__dirname, "..");
const installRoot = path.resolve(appRoot, "..", "..");
const outputRoot = path.join(installRoot, "acceptance-output-20260804-final");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runRoot = path.join(outputRoot, runId);
const projectsRoot = path.join(runRoot, "projects");
fs.mkdirSync(projectsRoot, { recursive: true });

const report = {
  schemaVersion: 1,
  runId,
  startedAt: new Date().toISOString(),
  appRoot,
  criteria: [],
  templates: [],
};

function executable(name) {
  return process.platform === "win32" && ["npm", "npx"].includes(name) ? `${name}.cmd` : name;
}

function run(command, args, cwd, timeoutMs = 300_000) {
  return new Promise((resolve) => {
    const target = executable(command);
    const usesCommandShim = process.platform === "win32" && target.endsWith(".cmd");
    const child = spawn(usesCommandShim ? (process.env.ComSpec || "cmd.exe") : target, usesCommandShim
      ? ["/d", "/s", "/c", [target, ...args].map((value) => /[^a-zA-Z0-9_./:@=-]/.test(value) ? `"${String(value).replace(/"/g, '""')}"` : value).join(" ")]
      : args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0", BROWSER: "none" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk) => {
      const text = String(chunk || "");
      output = `${output}${text}`.slice(-120_000);
      process.stdout.write(text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      if (child.exitCode !== null) return;
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      else child.kill("SIGTERM");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, command: `${command} ${args.join(" ")}`, error: error.message, outputTail: output.slice(-5000) });
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, command: `${command} ${args.join(" ")}`, exitCode: code, outputTail: output.slice(-5000) });
    });
  });
}

function criterion(id, area, ok, evidence, detail = "") {
  const item = { id, area, ok: Boolean(ok), evidence, detail };
  report.criteria.push(item);
  console.log(`\n[${item.ok ? "PASS" : "FAIL"}] ${id}: ${detail || evidence}`);
  return item;
}

async function main() {
  const check = await run("npm", ["run", "check"], appRoot);
  criterion("runtime-static-check", "runtime", check.ok, check.command, check.outputTail.slice(-800));

  const tests = await run("npm", ["test"], appRoot);
  criterion("runtime-tests", "runtime", tests.ok, tests.command, tests.outputTail.slice(-1000));

  const desktopAudit = await run("npm", ["audit", "--omit=dev"], appRoot);
  criterion("desktop-production-audit", "security", desktopAudit.ok, desktopAudit.command, desktopAudit.outputTail.slice(-800));

  const cloudAudit = await run("npm", ["audit", "--omit=dev"], path.join(installRoot, "cloud"));
  criterion("cloud-production-audit", "security", cloudAudit.ok, cloudAudit.command, cloudAudit.outputTail.slice(-800));

  const scaffold = new ProjectScaffoldService();
  for (const template of ["soundonemusic", "lovable-web", "next-saas", "open-saas"]) {
    const name = `ACCEPTANCE_${template.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_${runId.slice(0, 10)}`;
    const startedAt = Date.now();
    try {
      const created = await scaffold.create({ name, template, parentPath: projectsRoot, install: true }, {
        onProgress: (step) => console.log(`[${template}] ${step.percent}% ${step.message}`),
        onOutput: (chunk) => process.stdout.write(String(chunk || "")),
      });
      const metadata = JSON.parse(fs.readFileSync(path.join(created.root, ".editcore", "scaffold-report.json"), "utf8"));
      const item = { template, ok: metadata.ok === true, root: created.root, durationMs: Date.now() - startedAt, commands: metadata.commands };
      report.templates.push(item);
      criterion(`template-${template}`, "templates", item.ok, path.join(created.root, ".editcore", "scaffold-report.json"), `${item.commands.length} comandos verificados en ${Math.round(item.durationMs / 1000)}s`);
    } catch (error) {
      const item = { template, ok: false, durationMs: Date.now() - startedAt, error: error?.message || String(error) };
      report.templates.push(item);
      criterion(`template-${template}`, "templates", false, path.join(projectsRoot, name, ".editcore", "scaffold-report.json"), item.error.slice(-1600));
    }
  }

  const passed = report.criteria.filter((item) => item.ok).length;
  report.finishedAt = new Date().toISOString();
  report.summary = { passed, total: report.criteria.length, percentage: report.criteria.length ? Math.round((passed / report.criteria.length) * 100) : 0 };
  const jsonPath = path.join(runRoot, "final-acceptance.json");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdown = [
    "# EDITCOREAI Final Acceptance",
    "",
    `Run: ${runId}`,
    `Defined criteria passed: ${passed}/${report.criteria.length} (${report.summary.percentage}%)`,
    "",
    "| Area | Criterion | Result | Evidence |",
    "|---|---|---|---|",
    ...report.criteria.map((item) => `| ${item.area} | ${item.id} | ${item.ok ? "PASS" : "FAIL"} | ${String(item.evidence).replace(/\|/g, "/")} |`),
    "",
    "This percentage covers only the criteria listed above. It is not a claim of absolute security or universal behavior.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(runRoot, "FINAL_ACCEPTANCE.md"), markdown, "utf8");
  console.log(`\nAcceptance report: ${jsonPath}`);
  if (passed !== report.criteria.length) process.exitCode = 1;
}

main().catch((error) => {
  report.finishedAt = new Date().toISOString();
  report.fatalError = error?.stack || String(error);
  fs.writeFileSync(path.join(runRoot, "final-acceptance.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(error);
  process.exitCode = 1;
});
