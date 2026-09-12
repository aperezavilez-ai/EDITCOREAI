"use strict";

const gatewayOrigin = "https://gafcore-gateway.vercel.app";
const adminToken = String(process.env.GAFCORE_ADMIN_TOKEN || "").trim();
const models = String(process.env.EDITCORE_GATEWAY_MODELS || "meai/claude-sonnet-4.6,apicredits/claude-sonnet-5")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (!adminToken) throw new Error("Falta GAFCORE_ADMIN_TOKEN.");

async function request(pathname, options) {
  const response = await fetch(`${gatewayOrigin}${pathname}`, { ...options, signal: AbortSignal.timeout(90_000) });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function main() {
  const projectsResult = await request("/api/admin/projects", { headers: { "x-admin-token": adminToken } });
  if (!projectsResult.response.ok || projectsResult.body?.ok === false) {
    throw new Error(projectsResult.body?.error?.message || `HTTP ${projectsResult.response.status}`);
  }
  const projects = Array.isArray(projectsResult.body?.data) ? projectsResult.body.data : [];
  const project = projects.find((item) => String(item?.name || "").trim().toLowerCase() === "editcore ai");
  if (!project?.project_key) throw new Error("EDITCOREAI no tiene project key.");

  const tool = {
    type: "function",
    function: {
      name: "list_files",
      description: "Lista archivos del proyecto",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  };
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${project.project_key}` };
  const responseShape = (body) => {
    const message = body?.choices?.[0]?.message || {};
    const content = message.content;
    return {
      rootKeys: body && typeof body === "object" ? Object.keys(body).slice(0, 12) : [],
      choiceKeys: body?.choices?.[0] && typeof body.choices[0] === "object" ? Object.keys(body.choices[0]).slice(0, 12) : [],
      messageKeys: message && typeof message === "object" ? Object.keys(message).slice(0, 12) : [],
      contentType: Array.isArray(content) ? "array" : typeof content,
      contentPreview: typeof content === "string" ? content.slice(0, 160) : Array.isArray(content) ? JSON.stringify(content).slice(0, 240) : "",
      finishReason: String(body?.choices?.[0]?.finish_reason || ""),
      anthropicBlocks: Array.isArray(body?.content) ? body.content.map((item) => ({ type: item?.type, name: item?.name })).slice(0, 8) : [],
      outputTypes: Array.isArray(body?.output) ? body.output.map((item) => item?.type).slice(0, 8) : [],
    };
  };
  const results = [];
  for (const model of models) {
    const chatStarted = Date.now();
    const chat = await request("/api/openai/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Responde solamente OK" }], max_tokens: 256, temperature: 0 }),
    });
    const chatText = String(chat.body?.choices?.[0]?.message?.content || "").trim();
    const chatMs = Date.now() - chatStarted;

    const toolStarted = Date.now();
    const toolResult = await request("/api/openai/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Usa la herramienta list_files con path igual a punto (.) ahora. No hagas preguntas." }],
        tools: [tool],
        tool_choice: "auto",
        max_tokens: 100,
        temperature: 0,
      }),
    });
    const toolMessage = toolResult.body?.choices?.[0]?.message || {};
    const toolCalls = Array.isArray(toolMessage.tool_calls) ? toolMessage.tool_calls : [];
    results.push({
      model,
      chatStatus: chat.response.status,
      chatOK: chat.response.ok && Boolean(chatText),
      chatMs,
      toolStatus: toolResult.response.status,
      toolOK: toolResult.response.ok && (toolCalls.length > 0 || /list_files/i.test(String(toolMessage.content || ""))),
      toolCalls: toolCalls.map((call) => call?.function?.name).filter(Boolean),
      toolMs: Date.now() - toolStarted,
      chatError: chat.response.ok ? "" : String(chat.body?.error?.message || chat.body?.message || "").slice(0, 180),
      toolError: toolResult.response.ok ? "" : String(toolResult.body?.error?.message || toolResult.body?.message || "").slice(0, 180),
      chatShape: responseShape(chat.body),
      toolShape: responseShape(toolResult.body),
    });
  }
  const report = { generatedAt: new Date().toISOString(), ok: results.every((item) => item.chatOK && item.toolOK), results };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exitCode = 2;
});
