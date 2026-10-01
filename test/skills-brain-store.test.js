"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-skills-brain-"));
const userDataPath = path.join(tmp, "userdata");
const projectRoot = path.join(tmp, "proyecto");
process.env.EDITCORE_USER_DATA_PATH = userDataPath;
fs.mkdirSync(projectRoot, { recursive: true });

function writeSkill(dir, name, description, body = "Instrucciones de la skill.") {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
}

const repoPath = path.join(userDataPath, "editcore-brain", "brain-store", "repos", "acme__skills");
writeSkill(path.join(repoPath, "skills", "seo-audit"), "seo-audit", "Audits SEO of landing pages and fixes meta tags.", "x".repeat(20_000));
writeSkill(path.join(repoPath, "skills", "frontend-design"), "frontend-design", "Copia del repo que no debe pisar la integrada.");
fs.writeFileSync(path.join(userDataPath, "editcore-brain", "brain-store", "installed.json"), JSON.stringify({
  version: 1,
  items: [{
    id: "acme-skills",
    name: "acme/skills",
    url: "https://github.com/acme/skills",
    installedPath: repoPath,
    skills: [
      { name: "seo-audit", description: "Audits SEO of landing pages and fixes meta tags.", relativePath: "skills/seo-audit/SKILL.md" },
      { name: "frontend-design", description: "Copia del repo que no debe pisar la integrada.", relativePath: "skills/frontend-design/SKILL.md" },
    ],
  }],
}));

const engine = require("../runtime/skills-engine");
const tools = require("../editcore-chat-kernel/tools");

test("listAllSkills incluye las skills de los repos del Cerebro sin pisar las locales", () => {
  const all = engine.listAllSkills({ projectRoot, userDataPath });
  const seo = all.find((s) => s.name === "seo-audit");
  assert.ok(seo);
  assert.equal(seo.scope, "brain");
  assert.equal(seo.repo, "acme/skills");
  assert.equal(seo.body, undefined);
  assert.equal(all.find((s) => s.name === "frontend-design").scope, "builtin");
  assert.equal(all[all.length - 1].scope, "brain");
});

test("las skills del Cerebro necesitan una coincidencia fuerte y su cuerpo se recorta", () => {
  const all = engine.listAllSkills({ projectRoot, userDataPath });
  assert.deepEqual(engine.matchSkillsForPrompt("con esto ya quedo", all), []);
  assert.deepEqual(engine.matchSkillsForPrompt("ALGO NO ESTA BIEN", all), []);
  const matched = engine.matchSkillsForPrompt("haz un seo audit de la landing", all);
  assert.equal(matched[0].name, "seo-audit");
  const block = engine.assembleSkillsSystemPrompt([matched[0]]);
  assert.match(block, /repo acme\/skills/);
  assert.match(block, /skill recortada/);
  assert.ok(block.length < 9_000);
});

test("palabras de 3 letras no coinciden como prefijo (con ≠ content)", () => {
  const skills = [{ name: "content-writer", description: "Writes content", category: "marketing", enabled: true }];
  assert.deepEqual(engine.matchSkillsForPrompt("hazlo con cuidado", skills), []);
});

test("las skills del Cerebro no se borran desde el panel de skills", () => {
  const out = engine.deleteSkill({ name: "seo-audit", scope: "brain", userDataPath });
  assert.equal(out.ok, false);
  assert.ok(fs.existsSync(path.join(repoPath, "skills", "seo-audit", "SKILL.md")));
});

test("scanSkillDir detecta skills en subcarpetas de un repo clonado", () => {
  const skillsRoot = path.join(projectRoot, ".editcore", "skills");
  writeSkill(path.join(skillsRoot, "repo-anidado", "skills", "pdf-tools"), "pdf-tools", "Lee y genera PDF.");
  writeSkill(path.join(skillsRoot, "directa"), "directa", "Skill en la raíz.");
  const names = engine.scanSkillDir(skillsRoot, "project").map((s) => s.name).sort();
  assert.deepEqual(names, ["directa", "pdf-tools"]);
});

test("install_skill informa las skills detectadas en el repo", async () => {
  const out = await tools.execute("install_skill", { repoUrl: "https://github.com/acme/anidado", skillName: "repo-anidado" }, projectRoot, true, {});
  assert.equal(out.ok, true);
  assert.equal(out.skillsDetected, 1);
  assert.deepEqual(out.skills, ["pdf-tools"]);
});

test("list_skills resume por origen y busca con query", async () => {
  const summary = await tools.execute("list_skills", {}, projectRoot, false, {});
  assert.equal(summary.ok, true);
  assert.ok(summary.byScope.brain >= 1);
  assert.ok(summary.builtin.length > 0);
  assert.deepEqual(summary.brainRepos, ["acme/skills (1)"]);
  assert.ok(JSON.stringify(summary).length < 2_000);

  const found = await tools.execute("list_skills", { query: "seo" }, projectRoot, false, {});
  assert.ok(found.matches.some((m) => m.startsWith("seo-audit [acme/skills]")));
});
