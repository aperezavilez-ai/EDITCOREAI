/**
 * runtime/crdt-sync.js
 * EditCoreAI - Motor de Sincronización CRDT Libre de Conflictos (Ciclos 37-39)
 */

class CrdtDocument {
  constructor(docId = "", initialText = "") {
    this.docId = docId || `doc_${Date.now()}`;
    this.clock = 0;
    this.siteId = `site_${Math.random().toString(36).slice(2, 6)}`;
    // Lista de caracteres con identificadores fraccionarios inmutables
    this.chars = [];

    if (initialText) {
      this.insertText(0, initialText);
    }
  }

  /**
   * Inserta un bloque de texto en una posición determinada
   */
  insertText(index, text, siteId = this.siteId) {
    if (!text) return [];
    const ops = [];
    const safeIndex = Math.max(0, Math.min(index, this.chars.length));

    for (let i = 0; i < text.length; i++) {
      this.clock++;
      const char = text[i];
      const prevPos = safeIndex + i > 0 ? this.chars[safeIndex + i - 1].pos : 0;
      const nextPos = safeIndex + i < this.chars.length ? this.chars[safeIndex + i].pos : prevPos + 1;
      const newPos = (prevPos + nextPos) / 2 || prevPos + 0.5;

      const item = {
        id: `${this.clock}@${siteId}_${i}`,
        pos: newPos,
        char,
        clock: this.clock,
        siteId,
        deleted: false,
      };

      this.chars.splice(safeIndex + i, 0, item);
      ops.push({ type: "insert", item });
    }

    return ops;
  }

  /**
   * Elimina un rango de caracteres
   */
  deleteRange(index, length) {
    const ops = [];
    const safeIndex = Math.max(0, Math.min(index, this.chars.length));
    const safeLen = Math.min(length, this.chars.length - safeIndex);

    for (let i = 0; i < safeLen; i++) {
      const charObj = this.chars[safeIndex + i];
      if (charObj && !charObj.deleted) {
        charObj.deleted = true;
        ops.push({ type: "delete", id: charObj.id });
      }
    }

    // Filtrar caracteres borrados
    this.chars = this.chars.filter((c) => !c.deleted);
    return ops;
  }

  /**
   * Aplica una operación remota
   */
  applyRemoteOp(op) {
    if (!op || !op.type) return false;

    if (op.type === "insert" && op.item) {
      const exists = this.chars.some((c) => c.id === op.item.id);
      if (!exists) {
        this.chars.push(op.item);
        this.chars.sort((a, b) => a.pos - b.pos);
        this.clock = Math.max(this.clock, op.item.clock || 0);
        return true;
      }
    } else if (op.type === "delete" && op.id) {
      this.chars = this.chars.filter((c) => c.id !== op.id);
      return true;
    }
    return false;
  }

  /**
   * Fusiona el estado de otro documento CRDT sin conflictos
   */
  merge(otherDoc) {
    if (!otherDoc || !Array.isArray(otherDoc.chars)) return this.getText();

    const seenIds = new Set(this.chars.map((c) => c.id));
    for (const remoteChar of otherDoc.chars) {
      if (!seenIds.has(remoteChar.id) && !remoteChar.deleted) {
        this.chars.push({ ...remoteChar });
        seenIds.add(remoteChar.id);
      }
    }

    this.chars.sort((a, b) => a.pos - b.pos);
    this.clock = Math.max(this.clock, otherDoc.clock || 0);
    return this.getText();
  }

  /**
   * Retorna el texto plano consolidado
   */
  getText() {
    return this.chars.filter((c) => !c.deleted).map((c) => c.char).join("");
  }
}

class CrdtEngine {
  constructor() {
    this.documents = new Map(); // docId -> CrdtDocument
  }

  getOrCreateDocument(docId, initialText = "") {
    let doc = this.documents.get(docId);
    if (!doc) {
      doc = new CrdtDocument(docId, initialText);
      this.documents.set(docId, doc);
    }
    return doc;
  }

  mergeDocuments(docIdA, docIdB) {
    const docA = this.documents.get(docIdA);
    const docB = this.documents.get(docIdB);
    if (!docA || !docB) return null;

    docA.merge(docB);
    return docA.getText();
  }
}

const crdtEngineInstance = new CrdtEngine();

module.exports = {
  CrdtDocument,
  CrdtEngine,
  crdtEngine: crdtEngineInstance,
};
