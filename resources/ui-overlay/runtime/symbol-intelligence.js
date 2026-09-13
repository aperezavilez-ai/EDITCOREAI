"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const SCRIPT_KINDS = new Map([
  [".js", ts.ScriptKind.JS], [".cjs", ts.ScriptKind.JS], [".mjs", ts.ScriptKind.JS],
  [".jsx", ts.ScriptKind.JSX], [".ts", ts.ScriptKind.TS], [".tsx", ts.ScriptKind.TSX],
]);

function lineOf(source, node) { return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1; }
function nodeName(node, source) {
  if (node.name?.getText) return node.name.getText(source).replace(/^['"]|['"]$/g, "");
  if (ts.isExportAssignment(node)) return "default";
  return "";
}
function exported(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword));
}
function symbolKind(node) {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return "function";
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return "class";
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return "method";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isVariableDeclaration(node)) return "variable";
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return "property";
  return "";
}
function componentKind(name, node) {
  if (/^use[A-Z0-9_]/.test(name)) return "hook";
  if (/^[A-Z]/.test(name) && (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node))) return "component";
  return symbolKind(node);
}

class SymbolIntelligence {
  parseFile(filePath, sourceText = null) {
    const absolute = path.resolve(filePath);
    const extension = path.extname(absolute).toLowerCase();
    const text = sourceText === null ? fs.readFileSync(absolute, "utf8") : String(sourceText);
    if (extension === ".json") return this.parseJson(absolute, text);
    const scriptKind = SCRIPT_KINDS.get(extension);
    if (scriptKind === undefined) return { filePath: absolute, language: extension.slice(1), symbols: [], imports: [], exports: [], references: [] };
    const source = ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true, scriptKind);
    const symbols = []; const imports = []; const exports = []; const identifiers = [];
    const visit = (node) => {
      if (ts.isImportDeclaration(node)) {
        const specifier = String(node.moduleSpecifier?.text || "");
        const names = [];
        const clause = node.importClause;
        if (clause?.name) names.push(clause.name.text);
        if (clause?.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) names.push(clause.namedBindings.name.text);
          else names.push(...clause.namedBindings.elements.map((item) => item.name.text));
        }
        imports.push({ specifier, names, line: lineOf(source, node), typeOnly: clause?.isTypeOnly === true });
      }
      if (ts.isExportDeclaration(node)) {
        const names = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map((item) => item.name.text) : ["*"];
        exports.push({ names, specifier: String(node.moduleSpecifier?.text || ""), line: lineOf(source, node) });
      } else if (ts.isExportAssignment(node)) {
        exports.push({ names: ["default"], specifier: "", line: lineOf(source, node) });
      }
      const baseKind = symbolKind(node);
      const name = nodeName(node, source);
      if (baseKind && name) {
        const kind = componentKind(name, node);
        const row = { name, kind, line: lineOf(source, node), endLine: source.getLineAndCharacterOfPosition(node.end).line + 1, exported: exported(node) };
        symbols.push(row);
        if (row.exported) exports.push({ names: [name], specifier: "", line: row.line });
      }
      if (ts.isIdentifier(node)) identifiers.push({ name: node.text, line: lineOf(source, node) });
      ts.forEachChild(node, visit);
    };
    visit(source);
    return {
      filePath: absolute,
      language: extension.slice(1),
      symbols,
      imports,
      exports,
      references: identifiers,
      diagnostics: source.parseDiagnostics.map((diagnostic) => ({ message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "), line: diagnostic.start === undefined ? 0 : source.getLineAndCharacterOfPosition(diagnostic.start).line + 1 })),
    };
  }

  parseJson(filePath, text) {
    try {
      const value = JSON.parse(text);
      const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
      return { filePath, language: "json", symbols: keys.map((name) => ({ name, kind: "property", line: 1, endLine: 1, exported: false })), imports: [], exports: [], references: [] };
    } catch (error) {
      return { filePath, language: "json", symbols: [], imports: [], exports: [], references: [], diagnostics: [{ message: error.message, line: 0 }] };
    }
  }
}

module.exports = { SCRIPT_KINDS, SymbolIntelligence };
