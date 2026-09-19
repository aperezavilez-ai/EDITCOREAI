const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const chatHomeJs = fs.readFileSync(path.join(root, "chat-home.js"), "utf8");
const rendererJs = fs.readFileSync(path.join(root, "renderer.js"), "utf8");

const buttonIds = [...indexHtml.matchAll(/id="([^"]+Btn[^"]*)"/g)].map((m) => m[1]);
const unique = [...new Set(buttonIds)];

console.log("Total unique button IDs in index.html:", unique.length);
const missing = [];
const wired = [];

for (const id of unique) {
  const inChatHome = chatHomeJs.includes(id);
  const inRenderer = rendererJs.includes(id);
  if (!inChatHome && !inRenderer) {
    missing.push(id);
  } else {
    wired.push({ id, inChatHome, inRenderer });
  }
}

console.log("? Wired buttons count:", wired.length);
console.log("?? Missing in both chat-home.js and renderer.js:", missing);
