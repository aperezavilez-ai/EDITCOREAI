"use strict";

/**
 * Stub vacío: este EDITCOREAI no usa Jarvis.
 * Mantiene exports para no romper requires residuales en main/brain/bot-registry.
 */

const JARVIS_BOTS = [];

function resolveJarvisRoot() {
  return "";
}

function loadJarvisPlugins() {
  return [];
}

function jarvisAgentCatalog() {
  return { agents: [], plugins: [], jarvisRoot: "" };
}

function enrichAgentInventory(inventory = {}) {
  return {
    skills: inventory.skills || [],
    installed: inventory.installed || [],
    catalog: inventory.catalog || [],
  };
}

function formatJarvisContextForPrompt() {
  return "";
}

module.exports = {
  JARVIS_BOTS,
  resolveJarvisRoot,
  loadJarvisPlugins,
  jarvisAgentCatalog,
  enrichAgentInventory,
  formatJarvisContextForPrompt,
};
