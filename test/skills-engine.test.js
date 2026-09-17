"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const skillsEngine = require("../runtime/skills-engine");

test("skills-engine: parseFrontmatter and stringifyFrontmatter", () => {
  const raw = `---
name: seo-master
description: "Experto en SEO"
category: marketing
---

# Reglas
1. Revisar títulos`;

  const parsed = skillsEngine.parseFrontmatter(raw);
  assert.equal(parsed.metadata.name, "seo-master");
  assert.equal(parsed.metadata.description, "Experto en SEO");
  assert.equal(parsed.metadata.category, "marketing");
  assert.match(parsed.body, /# Reglas/);

  const serialized = skillsEngine.stringifyFrontmatter(parsed.metadata, parsed.body);
  assert.match(serialized, /name: "seo-master"/);
  assert.match(serialized, /# Reglas/);
});

test("skills-engine: listAllSkills loads builtin skills", () => {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-skills-test-"));
  try {
    const list = skillsEngine.listAllSkills({ userDataPath: tmpUserData });
    assert.ok(list.length > 0, "Debe cargar habilidades builtin");
    const marketing = list.find((s) => s.name === "marketing-content-creator");
    assert.ok(marketing, "Debe incluir marketing-content-creator");
    assert.equal(marketing.enabled, true);
  } finally {
    fs.rmSync(tmpUserData, { recursive: true, force: true });
  }
});

test("skills-engine: saveSkill, toggle, and deleteSkill lifecycle", () => {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-skills-test2-"));
  try {
    const saved = skillsEngine.saveSkill({
      name: "custom-copywriter",
      description: "Escribe copys persuasivos",
      category: "copywriting",
      content: "# Guía de Copywriting\nUsa fórmulas AIDA y PAS.",
      userDataPath: tmpUserData,
      scope: "global",
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.name, "custom-copywriter");
    assert.ok(fs.existsSync(saved.filePath));

    let list = skillsEngine.listAllSkills({ userDataPath: tmpUserData });
    const found = list.find((s) => s.name === "custom-copywriter");
    assert.ok(found);
    assert.equal(found.enabled, true);

    // Toggle disable
    skillsEngine.toggleSkill({ name: "custom-copywriter", enabled: false, userDataPath: tmpUserData });
    list = skillsEngine.listAllSkills({ userDataPath: tmpUserData });
    const toggled = list.find((s) => s.name === "custom-copywriter");
    assert.equal(toggled.enabled, false);

    // Delete
    const deleted = skillsEngine.deleteSkill({ name: "custom-copywriter", userDataPath: tmpUserData });
    assert.equal(deleted.ok, true);
    assert.equal(fs.existsSync(saved.filePath), false);
  } finally {
    fs.rmSync(tmpUserData, { recursive: true, force: true });
  }
});

test("skills-engine: parseLearnPrompt detects skill creation intent", () => {
  const prompt = `Aprende esta habilidad:
---
name: react-native-expert
description: "Experto en desarrollo móvil React Native"
---
# Directivas
Optimiza flatlists y usa Hermes.`;

  const parsed = skillsEngine.parseLearnPrompt(prompt);
  assert.ok(parsed);
  assert.equal(parsed.isLearn, true);
  assert.equal(parsed.name, "react-native-expert");
  assert.equal(parsed.description, "Experto en desarrollo móvil React Native");
});

test("skills-engine: matchSkillsForPrompt matches keywords", () => {
  const sampleSkills = [
    { name: "marketing-content-creator", description: "Crea contenido y blogs de marketing", category: "marketing", enabled: true },
    { name: "as-performance-optimization", description: "Optimiza velocidad y memoria", category: "performance", enabled: true },
  ];

  const matched = skillsEngine.matchSkillsForPrompt("Necesito redactar un blog de marketing para mi campaña", sampleSkills);
  assert.ok(matched.length > 0);
  assert.equal(matched[0].name, "marketing-content-creator");
});
