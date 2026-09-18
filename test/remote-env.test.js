"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RemoteEnvManager } = require("../runtime/remote-env");

test("remote-env: prueba conexión SSH y ejecución de comandos remotos", async () => {
  const manager = new RemoteEnvManager();
  const conn = await manager.testSshConnection({ host: "192.168.1.50", port: 22, username: "deploy" });
  assert.equal(conn.ok, true);
  assert.equal(conn.connection.host, "192.168.1.50");

  const execRes = await manager.executeRemoteCommand(conn.connectionId, "uname -a");
  assert.equal(execRes.ok, true);
  assert.equal(execRes.exitCode, 0);
  assert.ok(execRes.stdout.includes("uname -a"));
});

test("remote-env: ciclo de vida de Dev Containers", async () => {
  const manager = new RemoteEnvManager();
  const started = await manager.startDevContainer({ image: "node:20-alpine", workspaceMount: "/app" });
  assert.equal(started.ok, true);
  assert.equal(started.status, "running");

  const status = manager.getContainerStatus(started.containerId);
  assert.equal(status.status, "running");
  assert.equal(status.image, "node:20-alpine");

  const stopped = await manager.stopDevContainer(started.containerId);
  assert.equal(stopped.ok, true);
  assert.equal(stopped.status, "stopped");
});
