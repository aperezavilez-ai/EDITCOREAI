"use strict";
const fs = require("fs");
const path = require("path");

const release = path.join(__dirname, "..", "release");
const setup = path.join(release, "EDITCOREAI-Setup.exe");
if (!fs.existsSync(setup)) {
  console.error("MISSING", setup);
  process.exit(1);
}
const entries = fs.readdirSync(release);
if (entries.length !== 1 || entries[0] !== "EDITCOREAI-Setup.exe") {
  console.error("RELEASE_NOT_CLEAN", entries);
  process.exit(1);
}
console.log("ok", setup, fs.statSync(setup).size);
console.log("RELEASE_OK_CLEAN");
console.log("path", release);
