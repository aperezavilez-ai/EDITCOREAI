/**
 * Task Worker Template
 * Procesa tareas de la cola de trabajo en hilos separados
 * 
 * Este worker se encarga de:
 * - Recibir tareas desde la cola principal
 * - Procesar tareas de manera asíncrona
 * - Reportar progreso y resultados
 * - Manejar errores y reintentos
 */

const { parentPort, workerData } = require('worker_threads');
const EventEmitter = require('events');

class TaskWorker extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            maxRetries: config.maxRetries || 3,
            retryDelay: config.retryDelay || 1000,
            timeout: config.timeout || 30000,
            ...config
        };
        this.currentTask = null;
        this.isProcessing = false;
    }

    /**
     * Inicializa el worker y configura listeners
     */
    initialize() {
        if (!parentPort) {
            throw new Error('Este módulo debe ejecutarse como Worker Thread');
        }

        parentPort.on('message', async (message) => {
            await this.handleMessage(message);
        });

        this.sendMessage({ type: 'ready', workerId: workerData?.workerId });
    }

    /**
     * Maneja mensajes entrantes desde el thread principal
     */
    async handleMessage(message) {
        const { type, task, data } = message;

        try {
            switch (type) {
                case 'process':
                    await this.processTask(task);
                    break;
                
                case 'cancel':
                    await this.cancelCurrentTask();
                    break;
                
                case 'ping':
                    this.sendMessage({ type: 'pong' });
                    break;
                
                case 'shutdown':
                    await this.shutdown();
                    break;
                
                default:
                    this.sendMessage({ 
                        type: 'error', 
                        error: `Tipo de mensaje desconocido: ${type}` 
                    });
            }
        } catch (error) {
            this.sendMessage({ 
                type: 'error', 
                error: error.message,
                stack: error.stack 
            });
        }
    }

    /**
     * Procesa una tarea con manejo de reintentos
     */
    async processTask(task) {
        if (this.isProcessing) {
            this.sendMessage({ 
                type: 'error', 
                error: 'Worker ya está procesando una tarea' 
            });
            return;
        }

        this.isProcessing = true;
        this.currentTask = task;
        
        let attempts = 0;
        let lastError = null;

        while (attempts < this.config.maxRetries) {
            try {
                this.sendMessage({ 
                    type: 'progress', 
                    taskId: task.id,
                    status: 'processing',
                    attempt: attempts + 1 
                });

                const result = await this.executeTask(task);

                this.sendMessage({ 
                    type: 'complete', 
                    taskId: task.id,
                    result 
                });

                this.currentTask = null;
                this.isProcessing = false;
                return;

            } catch (error) {
                lastError = error;
                attempts++;

                this.sendMessage({ 
                    type: 'retry', 
                    taskId: task.id,
                    attempt: attempts,
                    error: error.message 
                });

                if (attempts < this.config.maxRetries) {
                    await this.sleep(this.config.retryDelay * attempts);
                }
            }
        }

        // Todos los reintentos fallaron
        this.sendMessage({ 
            type: 'failed', 
            taskId: task.id,
            error: lastError.message,
            stack: lastError.stack,
            attempts 
        });

        this.currentTask = null;
        this.isProcessing = false;
    }

    /**
     * Ejecuta la tarea específica con timeout
     */
    async executeTask(task) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Tarea timeout después de ${this.config.timeout}ms`));
            }, this.config.timeout);

            this.performTaskLogic(task)
                .then(result => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }

    /**
     * Lógica principal de procesamiento de tareas
     * OVERRIDE este método en implementaciones específicas
     */
    async performTaskLogic(task) {
        const { type, payload } = task;

        // Implementación por defecto - extender según necesidad
        switch (type) {
            case 'compute':
                return await this.computeTask(payload);
            
            case 'io':
                return await this.ioTask(payload);
            
            case 'transform':
                return await this.transformTask(payload);
            
            default:
                throw new Error(`Tipo de tarea no soportado: ${type}`);
        }
    }

    /**
     * Tareas de cómputo intensivo
     */
    async computeTask(payload) {
        // Ejemplo: procesamiento CPU-intensivo
        const { data, operation } = payload;
        
        // Simular trabajo
        await this.sleep(100);
        
        return { 
            success: true, 
            result: `Procesado: ${operation}`,
            processedItems: data?.length || 0 
        };
    }

    /**
     * Tareas de I/O
     */
    async ioTask(payload) {
        // Ejemplo: lectura/escritura de archivos, llamadas de red
        const { path, operation } = payload;
        
        await this.sleep(50);
        
        return { 
            success: true, 
            path,
            operation 
        };
    }

    /**
     * Tareas de transformación de datos
     */
    async transformTask(payload) {
        // Ejemplo: transformaciones de datos, parsing
        const { input, transform } = payload;
        
        await this.sleep(75);
        
        return { 
            success: true, 
            transformed: true,
            size: JSON.stringify(input).length 
        };
    }

    /**
     * Cancela la tarea actual
     */
    async cancelCurrentTask() {
        if (!this.isProcessing) {
            return;
        }

        this.sendMessage({ 
            type: 'cancelled', 
            taskId: this.currentTask?.id 
        });

        this.currentTask = null;
        this.isProcessing = false;
    }

    /**
     * Apaga el worker de manera ordenada
     */
    async shutdown() {
        if (this.isProcessing) {
            await this.cancelCurrentTask();
        }

        this.sendMessage({ type: 'shutdown_complete' });
        
        // Dar tiempo para enviar el mensaje
        await this.sleep(100);
        
        process.exit(0);
    }

    /**
     * Envía mensaje al thread principal
     */
    sendMessage(message) {
        if (parentPort) {
            parentPort.postMessage({
                ...message,
                workerId: workerData?.workerId,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Utilidad para sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Reporta progreso de tarea de larga duración
     */
    reportProgress(taskId, progress) {
        this.sendMessage({
            type: 'progress',
            taskId,
            progress
        });
    }
}

// Inicializar worker si se ejecuta como Worker Thread
if (parentPort) {
    const worker = new TaskWorker(workerData?.config || {});
    worker.initialize();
}

module.exports = TaskWorker;
