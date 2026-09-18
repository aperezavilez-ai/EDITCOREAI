"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { loadUiSession, saveUiSession, compactProject } = require("../runtime/ui-session-store");
const { loadProjectChats, saveProjectChats, mergeProjectChatState } = require("../runtime/project-chat-store");

test("ui-session-store: saves and loads UI session in specified userData directory", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-session-test-"));
  try {
    const payload = {
      activeProjectId: "proj-1",
      projects: [
        {
          id: "proj-1",
          title: "Mi Proyecto 1",
          projectRoot: "C:\\Workspace\\proj1",
          chats: [
            {
              id: "chat-1",
              title: "Conversación Principal",
              createdAt: 1700000000000,
              updatedAt: 1700000005000,
              messages: [
                { role: "user", content: "Hola EditCore" },
                { role: "assistant", content: "¡Hola! ¿En qué puedo ayudarte?" },
              ],
            },
          ],
        },
      ],
    };

    const res = saveUiSession(tmpDir, payload);
    assert.equal(res.ok, true);
    assert.equal(res.projects, 1);

    const loaded = loadUiSession(tmpDir);
    assert.ok(loaded);
    assert.equal(loaded.activeProjectId, "proj-1");
    assert.equal(loaded.projects.length, 1);
    assert.equal(loaded.projects[0].title, "Mi Proyecto 1");
    assert.equal(loaded.projects[0].chats.length, 1);
    assert.equal(loaded.projects[0].chats[0].createdAt, 1700000000000);
    assert.equal(loaded.projects[0].chats[0].messages.length, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ui-session-store: guards against accidental overwrite with empty projects list", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-session-guard-test-"));
  try {
    // 1. Guardar proyectos existentes
    saveUiSession(tmpDir, {
      activeProjectId: "proj-persist",
      projects: [
        { id: "proj-persist", title: "Proyecto Importante", projectRoot: "C:\\test", chats: [{ id: "c1", title: "Chat 1" }] },
      ],
    });

    // 2. Intentar guardar lista vacia sin allowEmpty (simula guardado accidental antes de hidratacion)
    const res = saveUiSession(tmpDir, {
      activeProjectId: "",
      projects: [],
      allowEmpty: false,
    });
    assert.equal(res.skipped, true);

    // 3. Comprobar que los proyectos previos en disco siguen intactos
    const loaded = loadUiSession(tmpDir);
    assert.equal(loaded.projects.length, 1);
    assert.equal(loaded.projects[0].id, "proj-persist");

    // 4. Con allowEmpty: true (eliminacion explicita), si debe permitir vaciar
    const resExplicit = saveUiSession(tmpDir, {
      activeProjectId: "",
      projects: [],
      allowEmpty: true,
    });
    assert.equal(resExplicit.projects, 0);
    const loadedEmpty = loadUiSession(tmpDir);
    assert.equal(loadedEmpty.projects.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("project-chat-store: merges memory chats with disk chats preserving messages", () => {
  const memProject = {
    id: "p1",
    activeChatId: "c1",
    chats: [
      { id: "c1", title: "Chat 1", messages: [{ role: "user", content: "Msg 1" }], updatedAt: 100 },
    ],
  };
  const diskBundle = {
    savedAt: 200,
    activeChatId: "c2",
    chats: [
      { id: "c1", title: "Chat 1", messages: [{ role: "user", content: "Msg 1" }, { role: "assistant", content: "Msg 2" }], updatedAt: 150 },
      { id: "c2", title: "Chat 2", messages: [{ role: "user", content: "Msg A" }], updatedAt: 200 },
    ],
  };

  const merged = mergeProjectChatState(memProject, diskBundle);
  assert.equal(merged.chats.length, 2);
  const c1 = merged.chats.find((c) => c.id === "c1");
  assert.equal(c1.messages.length, 2, "c1 debe conservar los 2 mensajes del disco");
  const c2 = merged.chats.find((c) => c.id === "c2");
  assert.ok(c2, "c2 debe existir en el proyecto fusionado");
});
