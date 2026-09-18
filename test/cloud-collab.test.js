"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { CloudCollabChannel } = require("../runtime/cloud-collab");

describe("CloudCollabChannel", () => {
  it("publica y sincroniza payload", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-cloud-"));
    const channel = new CloudCollabChannel({ peerId: "peer-a", passphrase: "secret", outboxDir: path.join(root, "out"), inboxDir: path.join(root, "in") });
    const publish = await channel.publishState({ hello: "world" });
    assert.ok(publish.ok);
    const outFile = fs.readdirSync(channel.outboxDir)[0];
    const src = path.join(channel.outboxDir, outFile);
    const dst = path.join(channel.inboxDir, outFile);
    fs.renameSync(src, dst);
    const sync = await channel.syncInbox();
    assert.strictEqual(sync.accepted, 1);
  });
});
