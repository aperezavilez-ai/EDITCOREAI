const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

class AstRefactorer {
  constructor(options = {}) {
    this.supportedExtensions = new Set([".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"]);
    this.backupDir = options.backupDir || path.join(os.tmpdir(), "editcore-ast-backups");
    this.maxBackupsPerFile = options.maxBackupsPerFile || 10;
    this.ensureBackupDir();
  }

  ensureBackupDir() {
    fs.mkdirSync(this.backupDir, { recursive: true });
  }

  isSupported(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedExtensions.has(ext);
  }

  async parse(filePath) {
    const content = await fs.promises.readFile(filePath, "utf8");
    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
      return this.parseJavaScript(content, filePath);
    }

    if (ext === ".ts" || ext === ".tsx" || ext === ".jsx") {
      return this.parseTypeScriptLike(content, filePath);
    }

    throw new Error(`Extensión no soportada para AST: ${ext}`);
  }

  parseJavaScript(content, filePath) {
    const ast = {
      type: "Program",
      loc: { file: filePath },
      body: [],
      source: content,
    };

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
        continue;
      }

      if (trimmed.startsWith("import ") || trimmed.startsWith("export ")) {
        ast.body.push({ type: "ImportDeclaration", raw: line, line: i + 1 });
        continue;
      }

      if (trimmed.startsWith("class ")) {
        const classNode = this.parseClassDeclaration(line, i + 1, lines);
        ast.body.push(classNode);
        continue;
      }

      if (trimmed.startsWith("function ")) {
        const fnNode = this.parseFunctionDeclaration(line, i + 1, lines);
        ast.body.push(fnNode);
        continue;
      }

      if (trimmed.startsWith("const ") || trimmed.startsWith("let ") || trimmed.startsWith("var ")) {
        const varNode = this.parseVariableDeclaration(line, i + 1, lines);
        ast.body.push(varNode);
        continue;
      }

      if (trimmed.startsWith("return ") || trimmed.startsWith("return;")) {
        ast.body.push({ type: "ReturnStatement", raw: line, line: i + 1 });
        continue;
      }

      if (trimmed.startsWith("if ") || trimmed.startsWith("if(")) {
        ast.body.push({ type: "IfStatement", raw: line, line: i + 1 });
        continue;
      }

      if (trimmed.startsWith("for ") || trimmed.startsWith("while ") || trimmed.startsWith("do ")) {
        ast.body.push({ type: "LoopStatement", raw: line, line: i + 1 });
        continue;
      }

      if (trimmed.startsWith("try ") || trimmed.startsWith("try{")) {
        ast.body.push({ type: "TryStatement", raw: line, line: i + 1 });
        continue;
      }

      if (trimmed.startsWith("switch ")) {
        ast.body.push({ type: "SwitchStatement", raw: line, line: i + 1 });
        continue;
      }

      if (trimmed.startsWith("throw ")) {
        ast.body.push({ type: "ThrowStatement", raw: line, line: i + 1 });
        continue;
      }

      if (trimmed.startsWith("async ") || trimmed.startsWith("await ")) {
        ast.body.push({ type: "AsyncExpression", raw: line, line: i + 1 });
        continue;
      }

      if (trimmed.includes("=>") || trimmed.includes("function(")) {
        ast.body.push({ type: "FunctionExpression", raw: line, line: i + 1 });
        continue;
      }

      if (trimmed.startsWith("module.") || trimmed.startsWith("exports.")) {
        ast.body.push({ type: "ModuleAssignment", raw: line, line: i + 1 });
        continue;
      }

      ast.body.push({ type: "ExpressionStatement", raw: line, line: i + 1 });
    }

    return ast;
  }

  parseTypeScriptLike(content, filePath) {
    const baseAst = this.parseJavaScript(content, filePath);
    baseAst.type = "TypeScriptProgram";
    baseAst.language = "typescript-like";

    baseAst.body = baseAst.body.map((node) => {
      if (node.type === "ImportDeclaration" && node.raw.includes(" from ")) {
        return { ...node, type: "TSImportDeclaration" };
      }
      if (node.type === "FunctionDeclaration" && node.raw.includes(":")) {
        return { ...node, type: "TSFunctionDeclaration" };
      }
      return node;
    });

    return baseAst;
  }

  parseClassDeclaration(raw, lineNumber, lines) {
    const match = raw.match(/class\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    const name = match ? match[1] : "AnonymousClass";
    const classNode = {
      type: "ClassDeclaration",
      name,
      raw,
      line: lineNumber,
      methods: [],
      properties: [],
      decorators: [],
    };

    const decoratorMatch = raw.match(/@\w+/g);
    if (decoratorMatch) {
      classNode.decorators = decoratorMatch;
    }

    for (let i = lineNumber; i < lines.length; i++) {
      const current = lines[i];
      const trimmed = current.trim();
      if (!trimmed || trimmed === "}") continue;

      if (trimmed.startsWith("constructor(")) {
        classNode.methods.push({ type: "Constructor", raw: current, line: i + 1 });
        continue;
      }

      const methodMatch = trimmed.match(/^\s*(async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
      if (methodMatch && !trimmed.startsWith("class ")) {
        classNode.methods.push({ type: "Method", name: methodMatch[2], raw: current, line: i + 1 });
        continue;
      }

      if (trimmed.includes("=") && !trimmed.includes("=>") && !trimmed.includes("(")) {
        classNode.properties.push({ type: "Property", raw: current, line: i + 1 });
      }
    }

    return classNode;
  }

  parseFunctionDeclaration(raw, lineNumber, lines) {
    const match = raw.match(/function\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    const name = match ? match[1] : "AnonymousFunction";
    return {
      type: "FunctionDeclaration",
      name,
      raw,
      line: lineNumber,
      params: this.extractParams(raw),
      async: raw.includes("async "),
    };
  }

  parseVariableDeclaration(raw, lineNumber, lines) {
    const match = raw.match(/(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    const name = match ? match[1] : "AnonymousVariable";
    const isFunction = raw.includes("=>") || raw.includes("function(");
    return {
      type: "VariableDeclaration",
      name,
      raw,
      line: lineNumber,
      kind: raw.startsWith("const ") ? "const" : raw.startsWith("let ") ? "let" : "var",
      isFunction,
      params: isFunction ? this.extractParams(raw) : [],
    };
  }

  extractParams(raw) {
    const match = raw.match(/\(([^)]*)\)/);
    if (!match) return [];
    return match[1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  }

  async renameSymbol(filePath, oldName, newName, options = {}) {
    if (!this.isSupported(filePath)) {
      throw new Error(`Archivo no soportado para refactorización: ${filePath}`);
    }

    const backupPath = await this.createBackup(filePath);
    const content = await fs.promises.readFile(filePath, "utf8");
    const ast = await this.parse(filePath);

    const renameCandidates = this.buildRenameCandidates(ast, oldName);
    if (!renameCandidates.length) {
      return { applied: false, reason: "NO_CANDIDATES", backupPath };
    }

    const scopedCandidates = this.filterScopedCandidates(renameCandidates, options.scope);
    if (!scopedCandidates.length) {
      return { applied: false, reason: "NO_SCOPED_CANDIDATES", backupPath };
    }

    const safeRename = this.validateRenameSafety(scopedCandidates, newName);
    if (!safeRename.valid) {
      return { applied: false, reason: "UNSAFE_RENAME", backupPath, conflicts: safeRename.conflicts };
    }

    const result = this.applyRenames(content, scopedCandidates, oldName, newName);
    await fs.promises.writeFile(filePath, result.transformed, "utf8");

    return {
      applied: true,
      filePath,
      oldName,
      newName,
      replacements: result.replacements,
      backupPath,
      scope: options.scope || "file",
    };
  }

  buildRenameCandidates(ast, symbolName) {
    const candidates = [];
    const visit = (node) => {
      if (!node || typeof node !== "object") return;

      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }

      if (node.type === "ClassDeclaration" && node.name === symbolName) {
        candidates.push({ node, kind: "class", line: node.line });
      }

      if ((node.type === "FunctionDeclaration" || node.type === "TSFunctionDeclaration") && node.name === symbolName) {
        candidates.push({ node, kind: "function", line: node.line });
      }

      if (node.type === "VariableDeclaration" && node.name === symbolName) {
        candidates.push({ node, kind: "variable", line: node.line });
      }

      if (node.type === "Method" && node.name === symbolName) {
        candidates.push({ node, kind: "method", line: node.line });
      }

      if (node.raw && node.type !== "ImportDeclaration") {
        const regex = new RegExp(`\\b${this.escapeRegex(symbolName)}\\b`);
        if (regex.test(node.raw)) {
          candidates.push({ node, kind: "reference", line: node.line });
        }
      }

      for (const key of Object.keys(node)) {
        if (key === "raw" || key === "source") continue;
        visit(node[key]);
      }
    };

    visit(ast);
    return candidates;
  }

  filterScopedCandidates(candidates, scope) {
    if (!scope || scope === "file") return candidates;
    if (scope === "class") {
      return candidates.filter((c) => c.kind === "class" || c.kind === "method" || c.kind === "property");
    }
    if (scope === "function") {
      return candidates.filter((c) => c.kind === "function" || c.kind === "variable");
    }
    return candidates;
  }

  validateRenameSafety(candidates, newName) {
    const conflicts = [];
    const invalidPattern = /^[0-9]/;
    const reserved = new Set(["arguments", "eval", "await", "async", "yield", "return", "break", "continue", "switch", "case", "default", "if", "else", "try", "catch", "finally", "throw", "typeof", "instanceof", "new", "delete", "void", "in", "of", "class", "extends", "super", "import", "export", "default", "from", "as", "const", "let", "var", "function", "return", "debugger", "static", "get", "set"]);

    if (invalidPattern.test(newName)) {
      conflicts.push("NEW_NAME_STARTS_WITH_NUMBER");
    }

    if (reserved.has(newName)) {
      conflicts.push("NEW_NAME_IS_RESERVED");
    }

    const existingNames = candidates.map((c) => c.node.name).filter(Boolean);
    if (existingNames.includes(newName)) {
      conflicts.push("NEW_NAME_ALREADY_EXISTS_IN_SCOPE");
    }

    return { valid: conflicts.length === 0, conflicts };
  }

  applyRenames(content, candidates, oldName, newName) {
    const replacements = [];
    const regex = new RegExp(`\\b${this.escapeRegex(oldName)}\\b`, "g");
    let transformed = content;
    let match;

    while ((match = regex.exec(transformed)) !== null) {
      const lineNumber = transformed.slice(0, match.index).split(/\r?\n/).length;
      const candidate = candidates.find((c) => c.line === lineNumber);
      if (candidate) {
        transformed = transformed.slice(0, match.index) + newName + transformed.slice(match.index + oldName.length);
        replacements.push({ line: lineNumber, oldName, newName, kind: candidate.kind });
        regex.lastIndex = match.index + newName.length;
      }
    }

    return { transformed, replacements };
  }

  async extractFunction(filePath, startLine, endLine, options = {}) {
    if (!this.isSupported(filePath)) {
      throw new Error(`Archivo no soportado para extracción: ${filePath}`);
    }

    const backupPath = await this.createBackup(filePath);
    const content = await fs.promises.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/);

    if (startLine < 1 || endLine > lines.length || startLine > endLine) {
      throw new Error(`Rango inválido: ${startLine}-${endLine}`);
    }

    const snippet = lines.slice(startLine - 1, endLine).join("\n");
    const functionName = options.functionName || this.generateFunctionName(snippet);
    const params = this.extractParams(snippet);

    const wrapper = this.buildExtractedFunction(functionName, params, snippet, options);
    const newContent = [
      ...lines.slice(0, startLine - 1),
      wrapper.declaration,
      "",
      ...lines.slice(endLine),
    ].join("\n");

    await fs.promises.writeFile(filePath, newContent, "utf8");

    return {
      applied: true,
      filePath,
      functionName,
      startLine,
      endLine,
      backupPath,
      declaration: wrapper.declaration,
      callSite: wrapper.callSite,
    };
  }

  generateFunctionName(snippet) {
    const words = snippet
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 3);

    if (!words.length) return "extractedFunction";

    const camel = words.map((w, i) => (i === 0 ? w.toLowerCase() : this.capitalize(w.toLowerCase()))).join("");
    return `extract${this.capitalize(camel)}`;
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  buildExtractedFunction(name, params, body, options) {
    const indent = options.indent || "  ";
    const asyncPrefix = body.includes("await ") ? "async " : "";
    const paramList = params.length ? params.join(", ") : "";
    const wrappedBody = body
      .split("\n")
      .map((line) => `${indent}${line}`)
      .join("\n");

    const declaration = `${asyncPrefix}function ${name}(${paramList}) {\n${wrappedBody}\n}`;
    const callSite = `${name}(${paramList})`;

    return { declaration, callSite };
  }

  async restructureClass(filePath, className, options = {}) {
    if (!this.isSupported(filePath)) {
      throw new Error(`Archivo no soportado para restructuración: ${filePath}`);
    }

    const backupPath = await this.createBackup(filePath);
    const ast = await this.parse(filePath);
    const classNode = ast.body.find((n) => n.type === "ClassDeclaration" && n.name === className);

    if (!classNode) {
      return { applied: false, reason: "CLASS_NOT_FOUND", backupPath };
    }

    const transformations = [];
    if (options.extractMethods) {
      transformations.push(...this.planMethodExtractions(classNode));
    }

    if (options.groupByVisibility) {
      transformations.push(...this.planVisibilityGrouping(classNode));
    }

    if (!transformations.length) {
      return { applied: false, reason: "NO_TRANSFORMATIONS_REQUESTED", backupPath };
    }

    const result = this.applyClassRestructure(ast, classNode, transformations);
    await fs.promises.writeFile(filePath, result.source, "utf8");

    return {
      applied: true,
      filePath,
      className,
      transformations: result.transformations,
      backupPath,
    };
  }

  planMethodExtractions(classNode) {
    return classNode.methods.map((method) => ({
      type: "EXTRACT_METHOD",
      name: method.name,
      source: method.raw,
    }));
  }

  planVisibilityGrouping(classNode) {
    return [
      { type: "GROUP_PUBLIC", count: classNode.methods.length },
      { type: "GROUP_PRIVATE", count: 0 },
    ];
  }

  applyClassRestructure(ast, classNode, transformations) {
    const source = ast.source || "";
    const applied = [];

    for (const transformation of transformations) {
      if (transformation.type === "EXTRACT_METHOD" && transformation.source) {
        applied.push({ type: "EXTRACT_METHOD", name: transformation.name });
      }
      if (transformation.type.startsWith("GROUP_")) {
        applied.push({ type: transformation.type, count: transformation.count });
      }
    }

    return { source, transformations: applied };
  }

  async createBackup(filePath) {
    const normalized = path.normalize(filePath);
    const basename = path.basename(normalized);
    const ext = path.extname(basename);
    const name = path.basename(normalized, ext);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `${name}__${timestamp}${ext}`;
    const backupPath = path.join(this.backupDir, backupName);

    await fs.promises.copyFile(normalized, backupPath);
    this.pruneBackups(normalized);

    return backupPath;
  }

  pruneBackups(filePath) {
    const normalized = path.normalize(filePath);
    const basename = path.basename(normalized);
    const ext = path.extname(basename);
    const name = path.basename(normalized, ext);
    const prefix = `${name}__`;

    let files = [];
    try {
      files = fs.readdirSync(this.backupDir).filter((f) => f.startsWith(prefix) && f.endsWith(ext));
    } catch {
      return;
    }

    if (files.length <= this.maxBackupsPerFile) return;

    files.sort();
    const toDelete = files.slice(0, files.length - this.maxBackupsPerFile);
    for (const file of toDelete) {
      try {
        fs.unlinkSync(path.join(this.backupDir, file));
      } catch {
        // ignore cleanup errors
      }
    }
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async analyze(filePath) {
    if (!this.isSupported(filePath)) {
      throw new Error(`Archivo no soportado para análisis: ${filePath}`);
    }

    const ast = await this.parse(filePath);
    const symbols = [];
    const references = [];
    const complexity = { functions: 0, classes: 0, imports: 0, expressions: 0 };

    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }

      if (node.type === "ClassDeclaration") {
        complexity.classes += 1;
        symbols.push({ kind: "class", name: node.name, line: node.line });
      }

      if ((node.type === "FunctionDeclaration" || node.type === "TSFunctionDeclaration") || node.type === "VariableDeclaration" && node.isFunction) {
        complexity.functions += 1;
        symbols.push({ kind: "function", name: node.name, line: node.line, params: node.params });
      }

      if (node.type === "VariableDeclaration") {
        symbols.push({ kind: "variable", name: node.name, line: node.line });
      }

      if (node.type === "ImportDeclaration" || node.type === "TSImportDeclaration") {
        complexity.imports += 1;
      }

      if (node.type === "ExpressionStatement" || node.type === "AsyncExpression") {
        complexity.expressions += 1;
      }

      if (node.type === "reference" && node.raw) {
        references.push({ raw: node.raw, line: node.line });
      }

      for (const key of Object.keys(node)) {
        if (key === "raw" || key === "source") continue;
        visit(node[key]);
      }
    };

    visit(ast);

    return {
      filePath,
      language: path.extname(filePath).toLowerCase().replace(".", ""),
      symbols,
      references,
      complexity,
    };
  }
}

module.exports = { AstRefactorer };
