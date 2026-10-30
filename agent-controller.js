"use strict";

// Máquina de estados idéntica a la de Cline
const STATE = {
  IDLE: "IDLE",
  THINKING: "THINKING", // Llamando a la API
  WAITING_APPROVAL: "WAITING_APPROVAL", // Esperando que el usuario apruebe en la UI
  EXECUTING: "EXECUTING", // Ejecutando la herramienta
  DONE: "DONE"
};

class AgentController {
  constructor(apiService, toolExecutor, uiBridge) {
    this.apiService = apiService;     // Tu provider.js
    this.toolExecutor = toolExecutor; // Tu tools.js
    this.uiBridge = uiBridge;         // El puente a Electron (IPC)
    
    this.state = STATE.IDLE;
    this.messages = [];
    this.currentTask = null;
    this.isAborted = false;
  }

  abort() {
    this.isAborted = true;
    this.state = STATE.IDLE;
  }

  async startTask(userPrompt, systemPrompt, projectRoot) {
    this.isAborted = false;
    this.state = STATE.THINKING;
    this.messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];

    this.uiBridge.updateStatus({ state: this.state, text: "Iniciando agente..." });

    // EL BUCLE PRINCIPAL DE LA MÁQUINA DE ESTADOS
    while (this.state !== STATE.DONE && this.state !== STATE.IDLE && !this.isAborted) {
      
      try {
        // 1. LLAMADA A LA API
        this.uiBridge.updateStatus({ state: STATE.THINKING, text: "Pensando..." });
        const response = await this.apiService.callChat({
          messages: this.messages,
          tools: this.toolExecutor.getDefinitions(), // Herramientas estrictas
          toolChoice: "auto" // Cline usa auto, pero su prompt fuerza el uso
        });

        if (this.isAborted) break;

        // Agregamos la respuesta del asistente
        this.messages.push(response.message);

        // 2. SI EL MODELO DICE QUE TERMINÓ
        if (response.message.content && response.message.content.includes("TASK_COMPLETE")) {
          this.state = STATE.DONE;
          this.uiBridge.updateStatus({ state: STATE.DONE, text: "Tarea terminada." });
          break;
        }

        // 3. SI EL MODELO QUIERE USAR HERRAMIENTAS
        if (response.message.tool_calls && response.message.tool_calls.length > 0) {
          
          for (const toolCall of response.message.tool_calls) {
            if (this.isAborted) break;

            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments || "{}");

            // 4. INTERCEPCIÓN DE PERMISOS (EL "ESCUDO" DE CLINE)
            // Aquí es donde Cline se detiene y espera. 
            this.state = STATE.WAITING_APPROVAL;
            this.uiBridge.updateStatus({ state: this.state, text: `Esperando aprobación para: ${toolName}` });

            // Le preguntamos a la interfaz de Electron: "¿El usuario aprueba esto?"
            const isApproved = await this.uiBridge.requestApproval(toolName, toolArgs);

            if (!isApproved) {
              // Si el usuario rechaza, le decimos al modelo que fue rechazado
              this.messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: "El usuario denegó la ejecución de esta herramienta." })
              });
              this.uiBridge.updateStatus({ state: STATE.THINKING, text: "Herramienta rechazada. Continuando..." });
              continue;
            }

            // 5. EJECUCIÓN
            this.state = STATE.EXECUTING;
            this.uiBridge.updateStatus({ state: STATE.EXECUTING, text: `Ejecutando ${toolName}...` });

            let result;
            try {
              result = await this.toolExecutor.execute(toolName, toolArgs, projectRoot);
            } catch (error) {
              result = { error: error.message };
            }

            // Devolvemos el resultado a la IA
            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: toolName,
              content: JSON.stringify(result)
            });
          }
        } else if (!response.message.content?.includes("TASK_COMPLETE")) {
          // Si no usó herramientas y no terminó, lo obligamos a actuar
          this.messages.push({ 
            role: "user", 
            content: "ERROR: No usaste ninguna herramienta. Debes usar herramientas para avanzar o escribir TASK_COMPLETE si ya terminaste." 
          });
        }

      } catch (error) {
        this.uiBridge.updateStatus({ state: STATE.IDLE, text: `Error: ${error.message}` });
        break;
      }
    }
  }
}

module.exports = { AgentController, STATE };