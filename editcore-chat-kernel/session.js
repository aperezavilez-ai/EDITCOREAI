"use strict";

const crypto = require("crypto");

class ChatSession {
  constructor() {
    this.id = null;
    this.kind = null;
    this.projectRoot = null;
    this.steps = [];
    this.alive = false;
    this.startedAt = 0;
  }

  start(kind, projectRoot) {
    this.id = crypto.randomBytes(8).toString("hex");
    this.kind = kind;
    this.projectRoot = projectRoot;
    this.steps = [];
    this.alive = true;
    this.startedAt = Date.now();
    return this.id;
  }

  kill() {
    this.id = null;
    this.kind = null;
    this.alive = false;
  }

  addStep(step) {
    if (!this.alive) return;
    this.steps.push(step);
  }

  readCount() {
    return this.steps.filter((s) => s.name === "read_file" && s.ok).length;
  }

  listCount() {
    return this.steps.filter((s) => s.name === "list_files" && s.ok).length;
  }
}

module.exports = { ChatSession };