/**
 * runtime/collab-sync.js
 * EditCoreAI - Sincronización Colaborativa en Tiempo Real y CRDTs (Ciclo 31)
 */

const { EventEmitter } = require("events");

/**
 * Representa un caracter/token atómico en la secuencia CRDT con timestamp lógico de Lamport
 */
class CRDTChar {
  constructor(id, char, siteId, clock, deleted = false) {
    this.id = id; // string o número único
    this.char = char;
    this.siteId = siteId;
    this.clock = clock;
    this.deleted = deleted;
  }
}

/**
 * Documento CRDT determinista basado en secuencia ordenada de identificadores
 */
class CRDTDocument {
  constructor(docId, siteId = "local_node") {
    this.docId = docId;
    this.siteId = siteId;
    this.clock = 0;
    this.elements = []; // Array<CRDTChar>
    this.peers = new Map(); // siteId -> { name, cursor, lastSeen }
  }

  /**
   * Inicializa el documento con un texto base
   */
  setText(text, siteId = "origin") {
    this.elements = [];
    this.clock = 0;
    for (let i = 0; i < text.length; i++) {
      this.clock++;
      const id = `${this.clock}@${siteId}_${i}`;
      this.elements.push(new CRDTChar(id, text[i], siteId, this.clock, false));
    }
  }

  /**
   * Obtiene el texto visible consolidado
   */
  getText() {
    return this.elements
      .filter((el) => !el.deleted)
      .map((el) => el.char)
      .join("");
  }

  /**
   * Inserta texto en una posición del texto visible
   */
  insert(pos, text, siteId = this.siteId) {
    const insertedOps = [];
    const visibleElements = this.elements.filter((el) => !el.deleted);
    const targetIdx = Math.max(0, Math.min(pos, visibleElements.length));

    // Determinar índice en la secuencia global (incluyendo eliminados)
    let globalIdx = 0;
    if (targetIdx > 0) {
      const prevVisible = visibleElements[targetIdx - 1];
      globalIdx = this.elements.indexOf(prevVisible) + 1;
    }

    for (let i = 0; i < text.length; i++) {
      this.clock++;
      const id = `${this.clock}@${siteId}_${Math.random().toString(36).slice(2, 6)}`;
      const prevId = (globalIdx + i > 0) ? this.elements[globalIdx + i - 1].id : null;
      const item = new CRDTChar(id, text[i], siteId, this.clock, false);
      this.elements.splice(globalIdx + i, 0, item);
      insertedOps.push({
        type: "insert",
        id: item.id,
        char: item.char,
        siteId: item.siteId,
        clock: item.clock,
        afterId: prevId,
      });
    }

    return insertedOps;
  }

  /**
   * Elimina un rango de caracteres en el texto visible (marca de tumba/tombstone)
   */
  delete(pos, length = 1, siteId = this.siteId) {
    const deletedOps = [];
    const visibleElements = this.elements.filter((el) => !el.deleted);
    const start = Math.max(0, Math.min(pos, visibleElements.length));
    const end = Math.min(start + length, visibleElements.length);

    for (let i = start; i < end; i++) {
      const target = visibleElements[i];
      target.deleted = true;
      this.clock = Math.max(this.clock, target.clock) + 1;
      deletedOps.push({
        type: "delete",
        id: target.id,
        siteId,
        clock: this.clock,
      });
    }

    return deletedOps;
  }

  /**
   * Aplica operaciones remotas de forma determinista y convergente
   */
  applyRemoteOp(op) {
    if (!op || !op.type) return false;

    this.clock = Math.max(this.clock, op.clock || 0) + 1;

    if (op.type === "insert") {
      const exists = this.elements.some((el) => el.id === op.id);
      if (exists) return false;

      const item = new CRDTChar(op.id, op.char, op.siteId, op.clock, false);

      if (op.afterId === null) {
        this.elements.unshift(item);
        return true;
      }

      if (op.afterId) {
        const afterIdx = this.elements.findIndex((el) => el.id === op.afterId);
        if (afterIdx !== -1) {
          this.elements.splice(afterIdx + 1, 0, item);
          return true;
        }
      }

      this.elements.push(item);
      return true;
    }

    if (op.type === "delete") {
      const target = this.elements.find((el) => el.id === op.id);
      if (target) {
        target.deleted = true;
        return true;
      }
    }

    return false;
  }
}

/**
 * Gestor de sesiones colaborativas en tiempo real
 */
class CollabSyncManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map(); // sessionId -> { docId, crdtDoc, peers: Map }
  }

  /**
   * Crea una nueva sesión colaborativa
   */
  createSession({ sessionId, docId = "default-doc", initialText = "", siteId = "host" } = {}) {
    const sId = sessionId || `collab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const crdtDoc = new CRDTDocument(docId, siteId);

    if (initialText) {
      crdtDoc.setText(initialText);
    }

    const session = {
      sessionId: sId,
      docId,
      crdtDoc,
      peers: new Map(),
      createdAt: new Date().toISOString(),
    };

    session.peers.set(siteId, {
      siteId,
      name: "Host",
      cursor: { line: 1, column: 1 },
      joinedAt: new Date().toISOString(),
    });

    this.sessions.set(sId, session);
    this.emit("session:created", { sessionId: sId, docId, siteId });

    return {
      sessionId: sId,
      docId,
      siteId,
      initialText: crdtDoc.getText(),
    };
  }

  /**
   * Conecta a un peer a una sesión activa
   */
  joinSession(sessionId, siteId, peerInfo = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Sesión ${sessionId} no encontrada`);
    }

    const peer = {
      siteId,
      name: peerInfo.name || `Peer_${siteId}`,
      cursor: peerInfo.cursor || { line: 1, column: 1 },
      joinedAt: new Date().toISOString(),
    };

    session.peers.set(siteId, peer);
    this.emit("peer:joined", { sessionId, peer });

    return {
      sessionId,
      docId: session.docId,
      siteId,
      text: session.crdtDoc.getText(),
      peers: Array.from(session.peers.values()),
    };
  }

  /**
   * Desconecta un peer de la sesión
   */
  leaveSession(sessionId, siteId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const removed = session.peers.delete(siteId);
    if (removed) {
      this.emit("peer:left", { sessionId, siteId });
    }
    return removed;
  }

  /**
   * Aplica una operación de inserción o borrado en el documento de la sesión
   */
  applyOperation(sessionId, op) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Sesión ${sessionId} no encontrada`);
    }

    let deltaOps = [];
    if (op.type === "insert") {
      deltaOps = session.crdtDoc.insert(op.position, op.text, op.siteId);
    } else if (op.type === "delete") {
      deltaOps = session.crdtDoc.delete(op.position, op.length, op.siteId);
    } else if (op.type === "remote") {
      const applied = session.crdtDoc.applyRemoteOp(op.delta);
      if (applied) deltaOps = [op.delta];
    }

    const currentText = session.crdtDoc.getText();
    this.emit("doc:changed", { sessionId, currentText, deltaOps });

    return {
      success: true,
      text: currentText,
      deltaOps,
    };
  }

  /**
   * Actualiza la posición del cursor de un peer
   */
  updateCursor(sessionId, siteId, position) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const peer = session.peers.get(siteId);
    if (peer) {
      peer.cursor = position;
      this.emit("cursor:moved", { sessionId, siteId, position });
      return true;
    }
    return false;
  }

  /**
   * Obtiene el texto consolidado del documento de la sesión
   */
  getDocumentText(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return "";
    return session.crdtDoc.getText();
  }

  /**
   * Lista los peers conectados a una sesión
   */
  getPeers(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return Array.from(session.peers.values());
  }
}

const collabSyncInstance = new CollabSyncManager();

module.exports = {
  CRDTChar,
  CRDTDocument,
  CollabSyncManager,
  collabSync: collabSyncInstance,
};
