"use strict";

const path = require("path");
const fs = require("fs");

const BUILT_IN_THEMES = [
  {
    id: "cursor-dark",
    name: "Cursor Obsidian Dark",
    author: "EditCoreAI Elite",
    type: "dark",
    background: "#0d0d11",
    foreground: "#e2e8f0",
    accent: "#6366f1",
    editorBackground: "#121217",
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night Storm",
    author: "Tokyo Community",
    type: "dark",
    background: "#1a1b26",
    foreground: "#c0caf5",
    accent: "#7aa2f7",
    editorBackground: "#1f2335",
  },
  {
    id: "one-dark-pro",
    name: "One Dark Pro",
    author: "Binaryify",
    type: "dark",
    background: "#21252b",
    foreground: "#abb2bf",
    accent: "#61afef",
    editorBackground: "#282c34",
  },
  {
    id: "dracula",
    name: "Dracula Official",
    author: "Zeno Rocha",
    type: "dark",
    background: "#282a36",
    foreground: "#f8f8f2",
    accent: "#bd93f9",
    editorBackground: "#1e1f29",
  },
  {
    id: "github-dark",
    name: "GitHub Dark High Contrast",
    author: "GitHub",
    type: "dark",
    background: "#010409",
    foreground: "#f0f6fc",
    accent: "#2f81f7",
    editorBackground: "#0d1117",
  },
];

class ExtensionsMarketplace {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.activeTheme = "cursor-dark";
  }

  listThemes() {
    return BUILT_IN_THEMES.map((t) => ({
      ...t,
      isActive: t.id === this.activeTheme,
    }));
  }

  getTheme(themeId) {
    return BUILT_IN_THEMES.find((t) => t.id === themeId) || BUILT_IN_THEMES[0];
  }

  setTheme(themeId) {
    const theme = this.getTheme(themeId);
    this.activeTheme = theme.id;
    return {
      ok: true,
      activeTheme: theme,
      cssVariables: {
        "--ec-bg": theme.background,
        "--ec-fg": theme.foreground,
        "--ec-accent": theme.accent,
        "--ec-editor-bg": theme.editorBackground,
      },
    };
  }
}

module.exports = {
  ExtensionsMarketplace,
  BUILT_IN_THEMES,
};
