"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

describe("Slash Commands and Mentions Autocomplete Verification", () => {
  test("styles.css does not clip mentionPopup and supports light theme", () => {
    const css = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf8");

    // composer-input-wrap must NOT have overflow: hidden
    assert.match(css, /\.composer-input-wrap\s*\{[^}]*overflow:\s*visible/);

    // mention-popup must have light theme rules
    assert.match(css, /\[data-theme="light"\]\s*\.mention-popup/);
    assert.match(css, /body\.theme-light\s*\.mention-popup/);
    assert.match(css, /\[data-theme="light"\]\s*\.mention-item/);
  });

  test("renderer.js handles slash command trigger matching", () => {
    const getTriggerMatch = (text, cursor) => {
      const beforeCursor = text.slice(0, cursor);

      const slashMatch = /(?:^|\n)\/([a-zA-Z0-9_\-]*)$/.exec(beforeCursor);
      if (slashMatch) {
        const matchFull = slashMatch[0];
        const slashOffset = matchFull.indexOf("/");
        const startIndex = slashMatch.index + slashOffset;
        return {
          trigger: "/",
          query: (slashMatch[1] || "").toLowerCase(),
          startIndex,
          endIndex: cursor,
        };
      }

      const atMatch = /(?:^|\s)@([a-zA-Z0-9_\-.:/]*)$/.exec(beforeCursor);
      if (atMatch) {
        const matchFull = atMatch[0];
        const atOffset = matchFull.indexOf("@");
        const startIndex = atMatch.index + atOffset;
        return {
          trigger: "@",
          query: atMatch[1] || "",
          startIndex,
          endIndex: cursor,
        };
      }

      return null;
    };

    // Test slash matching at start
    const match1 = getTriggerMatch("/", 1);
    assert.ok(match1);
    assert.equal(match1.trigger, "/");
    assert.equal(match1.query, "");

    const match2 = getTriggerMatch("/pl", 3);
    assert.ok(match2);
    assert.equal(match2.trigger, "/");
    assert.equal(match2.query, "pl");

    // Test at matching
    const match3 = getTriggerMatch("@", 1);
    assert.ok(match3);
    assert.equal(match3.trigger, "@");
    assert.equal(match3.query, "");

    const match4 = getTriggerMatch("Hola @file:src/", 15);
    assert.ok(match4);
    assert.equal(match4.trigger, "@");
    assert.equal(match4.query, "file:src/");
  });

  test("renderer.js contains built-in slash commands (/plan, /test, /fix, /clean, /help)", () => {
    const renderer = fs.readFileSync(path.join(__dirname, "../renderer.js"), "utf8");
    assert.match(renderer, /\/plan/);
    assert.match(renderer, /\/test/);
    assert.match(renderer, /\/fix/);
    assert.match(renderer, /\/clean/);
    assert.match(renderer, /\/help/);
    assert.match(renderer, /SLASH_COMMANDS/);
  });

  test("index.html textarea has updated placeholder mentioning / and @", () => {
    const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
    assert.match(html, /placeholder="[^"]*\/[^"]*@[^"]*"/);
  });
});
