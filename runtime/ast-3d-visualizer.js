"use strict";

const path = require("node:path");

/**
 * Ciclo 50: Visualizador Espacial de Arquitectura 3D (AST 3D Visualizer)
 * Transforma el AST y las dependencias del proyecto en coordenadas espaciales 3D
 * para navegación inmersiva de acoplamientos y flujos de datos.
 */
class Ast3dVisualizer {
  constructor() {
    this.cached3dGraph = null;
  }

  /**
   * Genera el grafo 3D proyectado a partir de nodos y dependencias
   */
  generate3dLayout(nodes = [], edges = []) {
    const layoutNodes = [];
    const layoutEdges = [];

    // Algoritmo de distribución helicoidal / esférica 3D
    const total = Math.max(1, nodes.length);
    const radius = 250;

    nodes.forEach((node, idx) => {
      const phi = Math.acos(-1 + (2 * idx) / total);
      const theta = Math.sqrt(total * Math.PI) * phi;

      const x = Math.round(radius * Math.cos(theta) * Math.sin(phi));
      const y = Math.round(radius * Math.sin(theta) * Math.sin(phi));
      const z = Math.round(radius * Math.cos(phi));

      const color = node.type === "Class" ? "#3b82f6" : node.type === "Function" ? "#10b981" : "#8b5cf6";
      const size = node.sideEffects?.length > 0 ? 12 : 8;

      layoutNodes.push({
        id: node.id,
        name: node.name,
        type: node.type,
        file: node.file,
        position3d: { x, y, z },
        color,
        size,
      });
    });

    edges.forEach((edge) => {
      layoutEdges.push({
        from: edge.from,
        to: edge.to,
        type: edge.type,
        color: edge.type === "calls" ? "#60a5fa" : "#94a3b8",
      });
    });

    this.cached3dGraph = {
      totalNodes: layoutNodes.length,
      totalEdges: layoutEdges.length,
      nodes: layoutNodes,
      edges: layoutEdges,
      boundingSphereRadius: radius,
      timestamp: new Date().toISOString(),
    };

    return this.cached3dGraph;
  }

  /**
   * Obtiene el último grafo 3D generado
   */
  get3dGraph() {
    return this.cached3dGraph;
  }
}

const ast3dVisualizer = new Ast3dVisualizer();

module.exports = {
  Ast3dVisualizer,
  ast3dVisualizer,
};
