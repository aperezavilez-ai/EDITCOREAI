"use strict";
const fs = require("fs");
const path = require("path");
const preload = fs.readFileSync(path.join(__dirname, "../preload.js"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
const inv = [...new Set([...preload.matchAll(/invoke\(\s*["']([^"']+)["']/g)].map((m) => m[1]))];
const hand = new Set([...main.matchAll(/ipcMain\.handle\(\s*["']([^"']+)["']/g)].map((m) => m[1]));
const missing = inv.filter((c) => !hand.has(c));
console.log(JSON.stringify({ invokes: inv.length, handlers: hand.size, missing }, null, 2));
