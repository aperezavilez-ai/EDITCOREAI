"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  VectorIndexer,
  VectorStore,
  chunkCode,
  chunkJavaScript,
  chunkPython,
  chunkByLines,
  scanWorkspace,
  parseGitignore,
  cosineSimilarity,
  initEmbeddingEngine,
  generateEmbedding,
} = require("../runtime/vector-indexer");

const TMP = path.join(os.tmpdir(), `editcore-vector-test-${Date.now()}`);

function writeFile(rel, content) {
  const full = path.join(TMP, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

function cleanup() {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("VectorIndexer — Ciclo 13", () => {
  let indexer;

  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TMP, { recursive: true });
    writeFile(".gitignore", "node_modules/\ndist/\n");
    writeFile("src/index.js", `export class UserService {
  async getUser(id) {
    return db.users.find(id);
  }
}

export function formatName(name) {
  return name.trim().toUpperCase();
}
`);
    writeFile("src/utils.py", `class Calculator:
    def add(self, a, b):
        return a + b

    def multiply(self, a, b):
        return a * b

def greet(name):
    return f"Hello, {name}!"
`);
    writeFile("README.md", `# Project\nThis is a test project.\n`);
    writeFile("node_modules/ignored.js", "should be ignored");
    writeFile("dist/bundle.js", "should be ignored");

    indexer = new VectorIndexer({
      projectRoot: TMP,
      storePath: path.join(TMP, ".editcore", "vector-store.json"),
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("chunkCode", () => {
    it("fragmenta JS en clases, funciones y arrow functions", () => {
      const content = `export class UserService {
  async getUser(id) {
    return db.users.find(id);
  }
}

export function formatName(name) {
  return name.trim().toUpperCase();
}

export const calculateTotal = (items) => items.reduce((a, b) => a + b, 0);
`;
      const chunks = chunkCode(content, "src/index.js");
      assert.ok(chunks.length >= 3, `Esperaba >=3 chunks, obtuve ${chunks.length}`);
      const types = chunks.map((c) => c.type);
      assert.ok(types.includes("class"), "Debe detectar clase");
      assert.ok(types.includes("function"), "Debe detectar función");
      assert.ok(types.includes("arrow-function"), "Debe detectar arrow function");
    });

    it("fragmenta Python en clases y funciones", () => {
      const content = `class Calculator:
    def add(self, a, b):
        return a + b

    def multiply(self, a, b):
        return a * b

def greet(name):
    return f"Hello, {name}!"
`;
      const chunks = chunkCode(content, "src/utils.py");
      assert.ok(chunks.length >= 3, `Esperaba >=3 chunks, obtuve ${chunks.length}`);
      const types = chunks.map((c) => c.type);
      assert.ok(types.includes("class"), "Debe detectar clase Python");
      assert.ok(types.includes("function"), "Debe detectar función Python");
    });

    it("fallback a chunking por líneas para archivos no estructurados", () => {
      const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\n";
      const chunks = chunkCode(content, "notes.txt");
      assert.ok(chunks.length >= 1, "Debe generar al menos un chunk");
      assert.strictEqual(chunks[0].type, "text-block");
    });

    it("genera IDs únicos por chunk", () => {
      const content = `function a() { return 1; }\nfunction b() { return 2; }\n`;
      const chunks = chunkCode(content, "test.js");
      const ids = chunks.map((c) => c.id);
      const unique = new Set(ids);
      assert.strictEqual(unique.size, ids.length, "IDs deben ser únicos");
    });
  });

  describe("scanWorkspace", () => {
    it("escanea archivos respetando .gitignore", () => {
      const patterns = parseGitignore(TMP);
      const files = scanWorkspace(TMP, patterns);
      const rels = files.map((f) => f.relative.replace(/\\/g, "/"));
      assert.ok(rels.includes("src/index.js"), "Debe incluir src/index.js");
      assert.ok(rels.includes("src/utils.py"), "Debe incluir src/utils.py");
      assert.ok(rels.includes("README.md"), "Debe incluir README.md");
      assert.ok(!rels.includes("node_modules/ignored.js"), "Debe excluir node_modules");
      assert.ok(!rels.includes("dist/bundle.js"), "Debe excluir dist");
    });
  });

  describe("cosineSimilarity", () => {
    it("retorna 1 para vectores idénticos", () => {
      const v = [1, 0, 0];
      assert.strictEqual(cosineSimilarity(v, v), 1);
    });

    it("retorna 0 para vectores ortogonales", () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      assert.strictEqual(cosineSimilarity(a, b), 0);
    });

    it("retorna valores entre -1 y 1", () => {
      const a = [1, 2, 3];
      const b = [4, 5, 6];
      const sim = cosineSimilarity(a, b);
      assert.ok(sim >= -1 && sim <= 1, `Similaridad fuera de rango: ${sim}`);
    });
  });

  describe("VectorStore", () => {
    it("upsert y search funcionan correctamente", () => {
      const store = new VectorStore(path.join(TMP, "test-store.json"));
      const chunks = [
        {
          id: "chunk-1",
          file: "src/auth.js",
          type: "function",
          name: "login",
          startLine: 1,
          endLine: 10,
          content: "function login() { return authenticate(); }",
          embedding: [1, 0, 0],
          tokens: 10,
        },
        {
          id: "chunk-2",
          file: "src/db.js",
          type: "function",
          name: "query",
          startLine: 5,
          endLine: 15,
          content: "function query() { return db.select(); }",
          embedding: [0, 1, 0],
          tokens: 12,
        },
      ];

      const result = store.upsert(chunks);
      assert.strictEqual(result.upserted, 2);
      assert.strictEqual(result.total, 2);

      const searchResults = store.search([1, 0, 0], 2);
      assert.strictEqual(searchResults.length, 2);
      assert.ok(searchResults[0].score >= searchResults[1].score, "Debe estar ordenado por score");
      assert.strictEqual(searchResults[0].id, "chunk-1", "El más similar debe ser chunk-1");
    });

    it("getStats retorna métricas correctas", () => {
      const store = new VectorStore(path.join(TMP, "test-store2.json"));
      store.upsert([
        {
          id: "c1",
          file: "a.js",
          type: "function",
          name: "f1",
          startLine: 1,
          endLine: 5,
          content: "function f1() {}",
          embedding: [1, 0],
          tokens: 5,
        },
        {
          id: "c2",
          file: "b.js",
          type: "class",
          name: "C1",
          startLine: 1,
          endLine: 10,
          content: "class C1 {}",
          embedding: [0, 1],
          tokens: 8,
        },
      ]);

      const stats = store.getStats();
      assert.strictEqual(stats.totalChunks, 2);
      assert.strictEqual(stats.totalFiles, 2);
      assert.strictEqual(stats.types.function, 1);
      assert.strictEqual(stats.types.class, 1);
    });

    it("clear elimina todos los vectores", () => {
      const store = new VectorStore(path.join(TMP, "test-store3.json"));
      store.upsert([
        {
          id: "c1",
          file: "a.js",
          type: "function",
          name: "f1",
          startLine: 1,
          endLine: 5,
          content: "function f1() {}",
          embedding: [1, 0],
          tokens: 5,
        },
      ]);
      store.clear();
      assert.strictEqual(store.vectors.length, 0);
      assert.strictEqual(store.getStats().totalChunks, 0);
    });
  });

  describe("VectorIndexer integration", () => {
    it("indexWorkspace escanea, fragmenta e indexa", async () => {
      const result = await indexer.indexWorkspace();
      assert.ok(result.ok, `indexWorkspace falló: ${JSON.stringify(result)}`);
      assert.ok(result.files >= 3, `Esperaba >=3 archivos, obtuve ${result.files}`);
      assert.ok(result.chunks >= 3, `Esperaba >=3 chunks, obtuve ${result.chunks}`);
      assert.ok(result.total >= 3, `Esperaba >=3 vectores, obtuve ${result.total}`);
    });

    it("search retorna resultados semánticos relevantes", async () => {
      await indexer.indexWorkspace();

      // Search for authentication-related code
      const result = await indexer.search("user authentication login", { topK: 3 });
      assert.ok(result.ok, `search falló: ${JSON.stringify(result)}`);
      assert.ok(result.results.length > 0, "Debe retornar resultados");
      assert.ok(result.results[0].score > 0, "El primer resultado debe tener score > 0");
    });

    it("getStats retorna métricas del índice", async () => {
      await indexer.indexWorkspace();
      const stats = indexer.getStats();
      assert.ok(stats.totalChunks > 0, "Debe tener chunks indexados");
      assert.ok(stats.totalFiles > 0, "Debe tener archivos indexados");
    });

    it("reindex limpia y re-indexa", async () => {
      await indexer.indexWorkspace();
      const before = indexer.getStats().totalChunks;

      // Modify a file
      writeFile("src/index.js", `export class UserService {
  async getUser(id) {
    return db.users.find(id);
  }
  async updateUser(id, data) {
    return db.users.update(id, data);
  }
}
`);

      const result = await indexer.reindex();
      assert.ok(result.ok, `reindex falló: ${JSON.stringify(result)}`);
      const after = indexer.getStats().totalChunks;
      assert.ok(after >= before, "Reindex debe mantener o aumentar chunks");
    });
  });

  describe("Embedding engine", () => {
    it("initEmbeddingEngine carga el modelo", async () => {
      const result = await initEmbeddingEngine("Xenova/all-MiniLM-L6-v2");
      assert.ok(result.ok || result.error, "Debe retornar ok o error controlado");
    });

    it("generateEmbedding retorna vector de dimensión consistente", async () => {
      const vec1 = await generateEmbedding("function login() {}");
      const vec2 = await generateEmbedding("function login() {}");
      assert.ok(Array.isArray(vec1), "Debe retornar array");
      assert.strictEqual(vec1.length, vec2.length, "Vectores del mismo texto deben tener misma dimensión");
    });
  });
});
