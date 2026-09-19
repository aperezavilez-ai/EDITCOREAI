"use strict";

/**
 * Exporta / comparte el hilo de chat o Composer como markdown.
 */

const fs = require("node:fs");
const path = require("node:path");

function normalizeMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((m) => ({
      role: String(m.role || m.author || "user"),
      content: String(m.content || m.text || "").trim(),
      at: m.at || m.createdAt || "",
    }))
    .filter((m) => m.content);
}

function formatSessionMarkdown({ title = "EDITCOREAI session", projectRoot = "", messages = [], steps = [] } = {}) {
  const lines = [
    `# ${title}`,
    "",
    `- Proyecto: \`${projectRoot || "(sin ruta)"}\``,
    `- Exportado: ${new Date().toISOString()}`,
    `- Mensajes: ${normalizeMessages(messages).length}`,
    "",
    "## Hilo",
    "",
  ];
  for (const msg of normalizeMessages(messages)) {
    lines.push(`### ${msg.role}${msg.at ? ` (${msg.at})` : ""}`, "", msg.content, "");
  }
  if (Array.isArray(steps) && steps.length) {
    lines.push("## Pasos / tools", "");
    for (const step of steps.slice(0, 80)) {
      const name = step.name || step.tool || "step";
      const target = step.path || step.input?.path || step.target || "";
      lines.push(`- ${step.ok === false ? "FAIL" : "OK"} ${name}${target ? ` → ${target}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function exportSession(projectRoot, input = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const md = formatSessionMarkdown({
    title: input.title || "EDITCOREAI session",
    projectRoot: root,
    messages: input.messages,
    steps: input.steps,
  });
  const dir = path.join(root, ".editcore", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = String(input.fileName || `session-${stamp}.md`).replace(/[^\w.\-]+/g, "_");
  const rel = `.editcore/sessions/${fileName}`;
  fs.writeFileSync(path.join(root, ...rel.split("/")), md, "utf8");
  return { ok: true, path: rel, bytes: Buffer.byteLength(md, "utf8"), markdown: md.slice(0, 4000) };
}

module.exports = {
  formatSessionMarkdown,
  exportSession,
  normalizeMessages,
};
