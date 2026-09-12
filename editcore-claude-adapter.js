"use strict";

/**
 * Compat: el adaptador vivo vive en runtime/.
 * Este archivo solo reexporta para evitar que packaging cargue una copia vieja.
 */
module.exports = require("./runtime/editcore-claude-adapter");
