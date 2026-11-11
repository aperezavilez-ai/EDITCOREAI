"use strict";

// [EDITCORE-INTEGRAL-B7] Propiedad del turno: cada turno pertenece al
// chat que lo pidió. Este módulo PURO (sin DOM ni Electron) concentra
// las decisiones de destino que antes se tomaban «contra el chat
// activo al terminar» en renderer.js:
//
//  - resolveChatDestination: dado el chat de ORIGEN del trabajo y el
//    chat activo al completar, el destino de persistencia es SIEMPRE
//    el de origen (si sigue existiendo); el activo solo es respaldo
//    cuando el chat de origen ya no existe (p. ej. fue cerrado).
//  - isOriginFeedVisible: pintar en el feed SOLO si el feed visible es
//    el del chat de origen; en caso contrario la respuesta vive en su
//    chat persistido y se ve al volver, nunca en el feed equivocado.
//  - shouldSettleCardOnNewThinking: appendThinking solo puede asentar
//    tarjetas de SU propia corrida (mismo runId) o tarjetas legadas
//    sin identidad cuando la nueva tampoco trae identidad; una
//    tarjeta viva de OTRA corrida jamás se asienta al crear otra.
//
// El renderer lo consume vía window.EditCoreChatTurnOwnership (script
// en index.html) y las pruebas lo requieren como módulo CommonJS.

(function exposeChatTurnOwnership(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreChatTurnOwnership = api;
})(typeof window !== "undefined" ? window : globalThis, function createChatTurnOwnership() {
  function cleanId(value) {
    return String(value || "").trim();
  }

  function chatsOf(project) {
    return project && Array.isArray(project.chats) ? project.chats : [];
  }

  function findChat(project, chatId) {
    const id = cleanId(chatId);
    if (!id) return null;
    return chatsOf(project).find((chat) => chat && cleanId(chat.id) === id) || null;
  }

  /**
   * Resuelve el destino de persistencia de un turno completado.
   * projects: lista de proyectos (objetos planos con chats[]).
   * originProjectId/originChatId: dónde nació el trabajo.
   * activeProjectId/activeChatId: lo visible al completar.
   * Devuelve { project, chat, projectId, chatId, isOrigin } o null.
   */
  function resolveChatDestination(projects, options = {}) {
    const list = Array.isArray(projects) ? projects : [];
    const originChatId = cleanId(options.originChatId);
    const originProjectId = cleanId(options.originProjectId);
    const activeChatId = cleanId(options.activeChatId);
    const activeProjectId = cleanId(options.activeProjectId);

    if (originChatId) {
      // Primero el proyecto de origen; si no, cualquier proyecto que
      // contenga ese chat (los ids de chat son únicos por construcción).
      const originProject = list.find((p) => p && cleanId(p.id) === originProjectId) || null;
      const inOrigin = originProject ? findChat(originProject, originChatId) : null;
      if (inOrigin) {
        return { project: originProject, chat: inOrigin, projectId: cleanId(originProject.id), chatId: originChatId, isOrigin: true };
      }
      for (const project of list) {
        const chat = findChat(project, originChatId);
        if (chat) return { project, chat, projectId: cleanId(project.id), chatId: originChatId, isOrigin: true };
      }
    }

    // Respaldo declarado: el chat de origen ya no existe (cerrado a
    // mitad de turno) — solo entonces se persiste contra el activo.
    if (activeChatId) {
      const activeProject = list.find((p) => p && cleanId(p.id) === activeProjectId) || null;
      const inActive = activeProject ? findChat(activeProject, activeChatId) : null;
      if (inActive) {
        return { project: activeProject, chat: inActive, projectId: cleanId(activeProject.id), chatId: activeChatId, isOrigin: false };
      }
      for (const project of list) {
        const chat = findChat(project, activeChatId);
        if (chat) return { project, chat, projectId: cleanId(project.id), chatId: activeChatId, isOrigin: false };
      }
    }
    return null;
  }

  /** El chat destino de un turno es su chat de origen, si existe. */
  function resolveTargetChatId(options = {}) {
    const originChatId = cleanId(options.originChatId);
    const known = Array.isArray(options.chatIds) ? options.chatIds.map(cleanId).filter(Boolean) : null;
    if (originChatId && (!known || known.includes(originChatId))) return originChatId;
    if (originChatId && known && !known.length) return originChatId;
    return cleanId(options.activeChatId);
  }

  /** ¿El feed visible es el del chat de origen del turno? */
  function isOriginFeedVisible(options = {}) {
    const originChatId = cleanId(options.originChatId);
    if (!originChatId) return true; // sin origen declarado: conducta histórica (pintar)
    if (originChatId !== cleanId(options.activeChatId)) return false;
    const originProjectId = cleanId(options.originProjectId);
    const activeProjectId = cleanId(options.activeProjectId);
    if (originProjectId && activeProjectId && originProjectId !== activeProjectId) return false;
    return true;
  }

  /**
   * ¿Puede appendThinking asentar `card` al crear una tarjeta nueva?
   * Solo tarjetas de la MISMA corrida, o tarjetas legadas sin
   * identidad cuando la nueva tarjeta tampoco la trae. Una tarjeta
   * con runId distinto (otra corrida viva) nunca se asienta.
   */
  function shouldSettleCardOnNewThinking(card = {}, next = {}) {
    const cardRunId = cleanId(card.runId);
    const nextRunId = cleanId(next.runId);
    if (cardRunId || nextRunId) return Boolean(cardRunId && nextRunId && cardRunId === nextRunId);
    const cardChatId = cleanId(card.chatId);
    const nextChatId = cleanId(next.chatId);
    if (cardChatId || nextChatId) return Boolean(cardChatId && nextChatId && cardChatId === nextChatId);
    return true; // ambas legadas sin identidad: conducta histórica
  }

  return {
    resolveChatDestination,
    resolveTargetChatId,
    isOriginFeedVisible,
    shouldSettleCardOnNewThinking,
  };
});
