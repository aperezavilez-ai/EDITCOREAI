"use strict";

const BRAIN_TOOL_DEFINITIONS = [
  ["brain_search", "Busca memoria, conocimiento y codigo indexado por el Cerebro de EditCore.", {
    query: { type: "string" },
    scope: { type: "string", enum: ["all", "memory", "code", "catalog"] },
    limit: { type: "integer", minimum: 1, maximum: 20 },
  }, ["query"]],
  ["brain_skill", "Abre una skill instalada en el Cerebro de EditCore por su nombre exacto.", {
    name: { type: "string" },
  }, ["name"]],
  ["brain_tools", "Muestra las herramientas del agente, skills y capacidades instaladas en EditCore.", {
    query: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  }, []],
].map(([name, description, properties, required]) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties, required, additionalProperties: false },
  },
}));

function compactHostTools(definitions = []) {
  return definitions.map((definition) => ({
    name: definition?.function?.name || "",
    description: definition?.function?.description || "",
  })).filter((tool) => tool.name);
}

function registerBrainTools(dispatcher, { brain, rootPath, hostTools = () => [], onAccess = async () => undefined } = {}) {
  if (!dispatcher || !brain || !rootPath) throw new Error("Brain tools requieren Dispatcher, Brain y proyecto activo.");

  const executeAudited = async (kind, details, operation) => {
    try {
      const result = await operation();
      await onAccess({ kind, ...details, ok: true });
      return result;
    } catch (error) {
      await onAccess({ kind, ...details, ok: false, error: String(error?.message || error).slice(0, 300) });
      throw error;
    }
  };

  const schema = (name) => BRAIN_TOOL_DEFINITIONS.find((item) => item.function.name === name)?.function.parameters ?? {};

  dispatcher.register({
    name: "brain_search",
    description: "Busca memoria, conocimiento y codigo indexado por el Cerebro de EditCore.",
    schema: schema("brain_search"),
    execute: async (input = {}) => {
      const query = String(input.query || "").trim();
      const scope = ["all", "memory", "code", "catalog"].includes(String(input.scope || "")) ? String(input.scope) : "all";
      const limit = Math.max(1, Math.min(20, Number(input.limit) || 8));
      if (!query) throw new Error("brain_search requiere una consulta.");
      return executeAudited("search", { query: query.slice(0, 300), scope }, () => brain.searchForAgent(rootPath, query, { scope, limit }));
    },
  });

  dispatcher.register({
    name: "brain_skill",
    description: "Abre una skill instalada en el Cerebro de EditCore por su nombre exacto.",
    schema: schema("brain_skill"),
    execute: async (input = {}) => {
      const name = String(input.name || "").trim();
      if (!name) throw new Error("brain_skill requiere el nombre de una skill.");
      return executeAudited("skill", { name: name.slice(0, 160) }, () => brain.readSkillForAgent(rootPath, name));
    },
  });

  dispatcher.register({
    name: "brain_tools",
    description: "Muestra las herramientas del agente, skills y capacidades instaladas en EditCore.",
    schema: schema("brain_tools"),
    execute: async (input = {}) => {
      const query = String(input.query || "").trim();
      const limit = Math.max(1, Math.min(100, Number(input.limit) || 50));
      return executeAudited("inventory", { query: query.slice(0, 300) }, async () => ({
        agentTools: compactHostTools(await hostTools()),
        ...(await brain.agentInventory(rootPath, query, limit)),
      }));
    },
  });

  return dispatcher;
}

module.exports = { BRAIN_TOOL_DEFINITIONS, registerBrainTools };
