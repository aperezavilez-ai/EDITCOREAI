"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  cloneWebPage,
  applyDataReplacements,
  assertHttpUrl,
  ensureWebCloneGoldenOnDisk,
  buildFallbackReactFiles,
} = require("../runtime/clone-web-page");

assert.equal(assertHttpUrl("https://example.com/x"), "https://example.com/x");
assert.throws(() => assertHttpUrl("file:///etc/passwd"));

assert.equal(applyDataReplacements("Hola {{TITLE}}", { TITLE: "Mundo" }), "Hola Mundo");
assert.equal(applyDataReplacements("{{CTA}}!", { CTA: "Go" }), "Go!");

{
  const files = buildFallbackReactFiles({
    title: "{{TITLE}}",
    description: "desc",
    extract: {
      title: "Demo",
      url: "https://example.com",
      bodyText: "hello world content for clone",
      tailwindClasses: ["flex", "gap-4", "bg-slate-900"],
      sections: [],
      keyStyles: [],
    },
    replacements: { TITLE: "Acme", CTA: "Probar", SUBTITLE: "Sub" },
  });
  const page = files.find((f) => f.path.endsWith("ClonedPage.tsx"));
  assert.ok(page);
  assert.match(page.content, /Acme/);
  assert.match(page.content, /Probar/);
  assert.doesNotMatch(page.content, /\{\{TITLE\}\}/);
}

{
  const golden = ensureWebCloneGoldenOnDisk();
  assert.ok(fs.existsSync(path.join(golden, "template.json")));
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-clone-"));
  const out = await cloneWebPage(tmp, {
    url: "https://example.com",
    title: "Demo Clone",
    skipVision: true,
    mergeApp: true,
    replacements: {
      TITLE: "Fuxion Landing",
      SUBTITLE: "Servicio adaptado",
      CTA: "Contratar",
    },
    mockExtract: {
      title: "Example Domain",
      url: "https://example.com",
      metaDescription: "Example",
      bodyText: "Example Domain This domain is for use in documentation examples.",
      htmlSnippet: "<main><h1>Example Domain</h1></main>",
      tailwindClasses: ["flex", "min-h-screen", "bg-white", "text-slate-900"],
      sections: [{ tag: "main", text: "Example Domain", className: "flex" }],
      keyStyles: [{ tag: "h1", fontSize: "32px", color: "rgb(0,0,0)" }],
      colors: { background: "rgb(255,255,255)", color: "rgb(0,0,0)" },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.goldTemplate, "web-clone-base");
  assert.ok(out.files.some((f) => /ClonedPage\.tsx$/.test(f)));
  assert.ok(fs.existsSync(path.join(tmp, "src", "pages", "ClonedPage.tsx")));
  assert.ok(fs.existsSync(path.join(tmp, "src", "App.tsx")));
  const page = fs.readFileSync(path.join(tmp, "src", "pages", "ClonedPage.tsx"), "utf8");
  assert.match(page, /Fuxion Landing/);
  assert.match(page, /Contratar/);
  assert.ok(fs.existsSync(path.join(tmp, "package.json")), "debe scaffold animated-pwa si no hay package.json");

  const dry = await cloneWebPage(tmp, { url: "https://example.com", dryRun: true });
  assert.equal(dry.dryRun, true);

  // Vision path: mock visionGenerate returns JSON files
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-clone-v-"));
  const visionOut = await cloneWebPage(tmp2, {
    url: "https://example.com",
    forceVision: true,
    model: "gpt-4o",
    replacements: { TITLE: "Vision Title", CTA: "Click" },
    mockExtract: {
      title: "V",
      url: "https://example.com",
      bodyText: "vision body text long enough",
      htmlSnippet: "<h1>V</h1>",
      tailwindClasses: ["p-4"],
      sections: [],
      keyStyles: [],
    },
  }, {
    model: "gpt-4o",
    visionGenerate: async () => JSON.stringify({
      files: [{
        path: "src/pages/ClonedPage.tsx",
        content: "export function ClonedPage(){ return <h1>{{TITLE}}</h1>; }\n",
      }],
    }),
  });
  assert.equal(visionOut.mode, "vision");
  const vpage = fs.readFileSync(path.join(tmp2, "src", "pages", "ClonedPage.tsx"), "utf8");
  assert.match(vpage, /Vision Title/);

  console.log("clone-web-page ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
