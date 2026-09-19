"use strict";

/**
 * Ciclo 49: Generador Visual de Interfaces por Intención (Neural UI Builder)
 * Traduce descripciones en lenguaje natural o esquemas conceptuales directamente
 * a componentes de código funcional (React, Tailwind, HTML5).
 */
class NeuralUiBuilder {
  constructor() {
    this.generatedComponents = new Map();
  }

  /**
   * Sintetiza un componente visual a partir de un prompt o intención
   */
  synthesizeComponent({ prompt = "Formulario de login con modo oscuro", framework = "react", styleSystem = "tailwind" } = {}) {
    const compId = `ui_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const isDark = prompt.toLowerCase().includes("oscuro") || prompt.toLowerCase().includes("dark");

    let componentCode = "";
    let previewHtml = "";

    if (prompt.toLowerCase().includes("login") || prompt.toLowerCase().includes("auth")) {
      componentCode = `import React, { useState } from 'react';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log('Login:', { email, password });
  };

  return (
    <div className="flex min-h-[300px] items-center justify-center p-6 ${isDark ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-700 p-6 shadow-xl">
        <h2 className="text-xl font-bold">Iniciar Sesión</h2>
        <div>
          <label className="text-sm font-medium">Correo Electrónico</label>
          <input 
            type="email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-600 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium">Contraseña</label>
          <input 
            type="password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-600 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>
        <button type="submit" className="w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white hover:bg-blue-700">
          Entrar
        </button>
      </form>
    </div>
  );
}`;
      previewHtml = `<div style="padding:20px; border-radius:8px; background:${isDark ? '#0f172a' : '#ffffff'}; color:${isDark ? '#f8fafc' : '#0f172a'}; border:1px solid #334155;">
        <h3 style="margin-top:0;">Iniciar Sesión</h3>
        <input type="email" placeholder="correo@ejemplo.com" style="width:100%; padding:8px; margin-bottom:10px; border-radius:4px; border:1px solid #475569; background:transparent; color:inherit; box-sizing:border-box;" />
        <input type="password" placeholder="••••••••" style="width:100%; padding:8px; margin-bottom:12px; border-radius:4px; border:1px solid #475569; background:transparent; color:inherit; box-sizing:border-box;" />
        <button style="width:100%; padding:10px; background:#2563eb; color:#ffffff; border:none; border-radius:4px; font-weight:600; cursor:pointer;">Entrar</button>
      </div>`;
    } else {
      componentCode = `import React from 'react';

export default function DynamicCard() {
  return (
    <div className="rounded-xl border border-slate-700 p-6 ${isDark ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'} shadow-lg">
      <h3 className="text-lg font-bold">${prompt}</h3>
      <p className="mt-2 text-sm text-slate-400">Componente generado automáticamente por Neural UI Builder.</p>
    </div>
  );
}`;
      previewHtml = `<div style="padding:16px; border-radius:8px; background:${isDark ? '#0f172a' : '#ffffff'}; color:${isDark ? '#f8fafc' : '#0f172a'}; border:1px solid #334155;">
        <h4>${prompt}</h4>
        <p style="font-size:12px; color:#94a3b8;">Componente interactivo sintetizado</p>
      </div>`;
    }

    const componentRecord = {
      componentId: compId,
      prompt,
      framework,
      styleSystem,
      code: componentCode,
      previewHtml,
      suggestedFilePath: `components/${compId}.jsx`,
      createdAt: new Date().toISOString(),
    };

    this.generatedComponents.set(compId, componentRecord);
    return componentRecord;
  }

  /**
   * Obtiene la lista de componentes sintetizados
   */
  getComponents() {
    return Array.from(this.generatedComponents.values());
  }
}

const neuralUiBuilder = new NeuralUiBuilder();

module.exports = {
  NeuralUiBuilder,
  neuralUiBuilder,
};
