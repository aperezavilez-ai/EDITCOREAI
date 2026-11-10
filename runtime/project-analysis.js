"use strict";

// ÚNICA IMPLEMENTACIÓN: project-analysis vive en la raíz del proyecto
// (../project-analysis.js). Este archivo era una copia gemela y derivó:
// su resolveExecutionMode traía guardias propias (no escalar en "chat
// explícito", saludos casuales) que contradicen el contrato probado de la
// raíz — en EditCore el modo Chat SÍ escala al Agente cuando el pedido
// necesita herramientas, y el saludo casual lo filtra el renderer en su
// capa. Al unificar ganó la semántica de la raíz (la de los tests y la que
// la UI ya usaba); este archivo solo re-exporta: cada arreglo se hace una
// sola vez, en ../project-analysis.js.
module.exports = require("../project-analysis.js");
