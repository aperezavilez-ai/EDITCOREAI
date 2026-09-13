"use strict";

function stripAnsi(value) { return String(value || "").replace(/\x1b\[[0-9;]*m/g, ""); }
function lines(value) { return stripAnsi(value).split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean); }

class DiagnosticEngine {
  diagnose(input = {}) {
    const output = stripAnsi(input.stderr || input.stdout || input.output || input.error || "");
    const rows = lines(output);
    const diagnostics = [];
    const add = (item) => {
      const key = JSON.stringify([item.code, item.file, item.line, item.message]);
      if (!diagnostics.some((existing) => existing.key === key)) diagnostics.push({ key, ...item });
    };
    for (const row of rows) {
      let match = row.match(/^(.+?)\((\d+),(\d+)\):\s*error\s*(TS\d+):\s*(.+)$/i);
      if (match) { add({ source: "typescript", file: match[1], line: Number(match[2]), column: Number(match[3]), code: match[4], message: match[5] }); continue; }
      match = row.match(/^(.+?):(\d+):(\d+)\s+(.+?)(?:\s{2,}|\s+)([a-z][\w/-]+)$/i);
      if (match) { add({ source: "lint", file: match[1], line: Number(match[2]), column: Number(match[3]), code: match[5], message: match[4] }); continue; }
      match = row.match(/(?:at\s+.*?\()?(.+?\.[cm]?[jt]sx?):(\d+):(\d+)\)?$/);
      if (match) { add({ source: "node", file: match[1], line: Number(match[2]), column: Number(match[3]), code: "STACK", message: rows[0] || row }); continue; }
      match = row.match(/^(?:not ok\s+\d+\s+-\s+|FAIL\s+)(.+)$/i);
      if (match) add({ source: "test", file: "", line: 0, column: 0, code: "TEST_FAILURE", message: match[1] });
    }
    if (!diagnostics.length && rows.length) add({ source: String(input.source || "shell"), file: "", line: 0, column: 0, code: String(input.code || "COMMAND_FAILED"), message: rows.find((row) => /error|fail|exception|cannot|unable|missing/i.test(row)) || rows[0] });
    const cleaned = diagnostics.map(({ key, ...item }) => item).slice(0, Math.min(20, Math.max(1, Number(input.limit) || 8)));
    const root = cleaned[0] || null;
    return {
      ok: false,
      source: root?.source || String(input.source || "tool"),
      summary: root ? `${root.code}: ${root.message}`.slice(0, 500) : "La herramienta fallo sin diagnostico legible.",
      rootCause: this.rootCause(root, rows),
      diagnostics: cleaned,
      relevantOutput: rows.slice(0, 20).join("\n").slice(0, 4000),
      omittedLines: Math.max(0, rows.length - 20),
    };
  }

  rootCause(diagnostic, rows) {
    if (!diagnostic) return "Resultado sin salida suficiente; revisar contrato y parametros de la herramienta.";
    if (/cannot find module|module not found/i.test(diagnostic.message)) return "Dependencia o import no resoluble.";
    if (/is not assignable|property .* does not exist|expected .* arguments/i.test(diagnostic.message)) return "Contrato de tipos incompatible; revisar la definicion compartida antes de corregir consumidores.";
    if (/syntax|unexpected token|unterminated/i.test(diagnostic.message)) return "Error sintactico localizado en el archivo indicado.";
    if (/assert|expected|test/i.test(diagnostic.message) || rows.some((row) => /assertionerror/i.test(row))) return "La implementacion no satisface el comportamiento esperado por la prueba.";
    return diagnostic.file ? "El primer error localizado es la causa candidata; verificar definiciones e imports relacionados." : "La primera falla relevante del comando es la causa candidata.";
  }

  strategy(diagnosis = {}) {
    const text = `${diagnosis.summary || ""} ${diagnosis.rootCause || ""}`.toLowerCase();
    if (/module|import|dependenc/.test(text)) return "dependency-fix";
    if (/type|assignable|property|argument/.test(text)) return "type-fix";
    if (/syntax|token/.test(text)) return "local-fix";
    if (/config/.test(text)) return "configuration-fix";
    if (/test|assert|expected/.test(text)) return "test-guided-fix";
    return "root-cause-review";
  }
}

module.exports = { DiagnosticEngine, stripAnsi };
