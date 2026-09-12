"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { detectProjectCategory, getImagesForProject, generateSvgLogo } = require("../runtime/project-assets");
const { scaffoldGreenfieldApp } = require("../runtime/greenfield-builder");
const { ProjectScaffoldService } = require("../project-scaffold-service");

test("project-assets: detects categories accurately", () => {
  assert.equal(detectProjectCategory("Crear tienda de ropa online"), "ecommerce");
  assert.equal(detectProjectCategory("App de delivery de comida y tacos"), "delivery");
  assert.equal(detectProjectCategory("Plataforma SaaS de analitica y metricas B2B"), "saas");
  assert.equal(detectProjectCategory("Portal inmobiliario para venta de casas"), "realestate");
  assert.equal(detectProjectCategory("Clinica medica y citas de salud"), "health");
  assert.equal(detectProjectCategory("Agencia creativa de diseno y branding"), "agency");
  assert.equal(detectProjectCategory("Proyecto generico"), "general");
});

test("project-assets: returns rich asset payload", () => {
  const assets = getImagesForProject("Tienda de calzado deportivo");
  assert.equal(assets.category, "ecommerce");
  assert.ok(assets.hero && assets.hero.startsWith("https://images.unsplash.com"));
  assert.ok(Array.isArray(assets.gallery) && assets.gallery.length >= 3);
  assert.ok(Array.isArray(assets.avatars) && assets.avatars.length >= 3);
});

test("project-assets: generates valid vector SVG logo", () => {
  const svg = generateSvgLogo({ name: "NovaTech" });
  assert.ok(svg.includes("<svg"));
  assert.ok(svg.includes("NovaTech"));
  assert.ok(svg.includes("</svg>"));
});

test("greenfield-builder: scaffolds complete modern React + Vite + Tailwind project", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-greenfield-test-"));
  try {
    const result = scaffoldGreenfieldApp(tempDir, {
      appName: "RestoPro",
      prompt: "App para restaurante de sushi gourmet y delivery",
    });

    assert.equal(result.ok, true);
    assert.equal(result.appName, "RestoPro");
    assert.ok(result.filesCount >= 23);

    const expectedFiles = [
      "package.json",
      "vite.config.ts",
      "tsconfig.json",
      "tailwind.config.js",
      "postcss.config.js",
      "index.html",
      "public/logo.svg",
      "src/index.css",
      "src/lib/utils.ts",
      "src/components/ui/Button.tsx",
      "src/components/ui/Card.tsx",
      "src/components/ui/Badge.tsx",
      "src/components/ui/Input.tsx",
      "src/components/ui/Dialog.tsx",
      "src/components/ui/Tabs.tsx",
      "src/components/ui/Table.tsx",
      "src/components/ui/ChartWidget.tsx",
      "src/components/layout/Navbar.tsx",
      "src/components/layout/Footer.tsx",
      "src/components/sections/Hero.tsx",
      "src/components/sections/Showcase.tsx",
      "src/App.tsx",
      "src/main.tsx",
      "README.md",
    ];

    for (const file of expectedFiles) {
      const fullPath = path.join(tempDir, ...file.split("/"));
      assert.ok(fs.existsSync(fullPath), `Expected file ${file} to exist on disk`);
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, "package.json"), "utf8"));
    assert.equal(pkg.name, "restopro");
    assert.ok(pkg.dependencies.react);
    assert.ok(pkg.dependencies["lucide-react"]);
    assert.ok(pkg.devDependencies.tailwindcss);
    assert.ok(pkg.devDependencies.vite);

    const indexHtml = fs.readFileSync(path.join(tempDir, "index.html"), "utf8");
    assert.ok(indexHtml.includes("RestoPro"));
    assert.ok(indexHtml.includes("viewport"));
    assert.ok(indexHtml.includes("/src/main.tsx"));

    const appTsx = fs.readFileSync(path.join(tempDir, "src", "App.tsx"), "utf8");
    assert.ok(appTsx.includes("<Navbar"));
    assert.ok(appTsx.includes("<Hero"));
    assert.ok(appTsx.includes("<Showcase"));
    assert.ok(appTsx.includes("<Footer"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("images-to-code: generates valid React scaffold component", () => {
  const { buildReactScaffold } = require("../runtime/images-to-code");
  const result = buildReactScaffold({ title: "FinTech Dashboard", description: "Métricas y transacciones" });
  assert.ok(result.component.includes("FinTech Dashboard"));
  assert.ok(result.component.includes("GeneratedView"));
  assert.ok(result.component.includes("Button"));
  assert.ok(result.component.includes("Card"));
});

test("ProjectScaffoldService: lists pro-web-app and scaffolds locally without errors", async () => {
  const service = new ProjectScaffoldService();
  const templates = service.listTemplates();
  const proTemplate = templates.find((t) => t.id === "pro-web-app");
  assert.ok(proTemplate, "pro-web-app template must be available in catalog");
  assert.equal(proTemplate.source, "builtin");

  const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-scaffold-test-"));
  try {
    const created = await service.create({
      name: "MyCleanApp",
      template: "pro-web-app",
      parentPath: tempParent,
      install: false,
    });

    assert.equal(created.ok || created.name === "MyCleanApp", true);
    assert.ok(fs.existsSync(path.join(created.root, "package.json")));
    assert.ok(fs.existsSync(path.join(created.root, "src", "App.tsx")));
    assert.ok(fs.existsSync(path.join(created.root, "src", "components", "ui", "Dialog.tsx")));
    assert.ok(fs.existsSync(path.join(created.root, "src", "components", "ui", "ChartWidget.tsx")));
    assert.ok(fs.existsSync(path.join(created.root, "public", "logo.svg")));
  } finally {
    fs.rmSync(tempParent, { recursive: true, force: true });
  }
});
