// ════════════════════════════════════════════════════════════════════
// PANEL DE LOGS - Claude Code
// ════════════════════════════════════════════════════════════════════

(function initLogsPanel() {
  const logsPanel = document.getElementById('logsPanel');
  const logsOutput = document.getElementById('logs-output');

  if (!logsPanel || !logsOutput) {
    console.warn('Panel de logs no encontrado en el DOM');
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // Toggle panel con Ctrl + ` O botón del toolbar
  // ──────────────────────────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === '`') {
      e.preventDefault();
      logsPanel.classList.toggle('collapsed');
    }
  });

  // Botón del toolbar
  const logsBtn = document.getElementById('logsBtn');
  if (logsBtn) {
    logsBtn.addEventListener('click', () => {
      logsPanel.classList.toggle('collapsed');
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Botones de control
  // ──────────────────────────────────────────────────────────────────
  document.querySelector('.logs-btn-close')?.addEventListener('click', () => {
    logsPanel.classList.add('collapsed');
  });

  document.querySelector('.logs-btn-minimize')?.addEventListener('click', () => {
    logsPanel.classList.add('collapsed');
  });

  // ──────────────────────────────────────────────────────────────────
  // Filtros de nivel
  // ──────────────────────────────────────────────────────────────────
  document.querySelectorAll('.logs-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Desactivar todos
      document.querySelectorAll('.logs-filter-btn').forEach(b => b.classList.remove('active'));
      // Activar el seleccionado
      btn.classList.add('active');

      const level = btn.dataset.level;
      const entries = document.querySelectorAll('.log-entry');

      entries.forEach(entry => {
        if (level === 'all' || entry.classList.contains(level)) {
          entry.style.display = 'flex';
        } else {
          entry.style.display = 'none';
        }
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Botón limpiar
  // ──────────────────────────────────────────────────────────────────
  document.querySelector('.logs-btn-clear')?.addEventListener('click', () => {
    logsOutput.innerHTML = '';
    appendLog('info', 'Logs limpiados');
  });

  // ──────────────────────────────────────────────────────────────────
  // Función para agregar log
  // ──────────────────────────────────────────────────────────────────
  function appendLog(level, message) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${level}`;

    const timestamp = new Date().toLocaleTimeString('es-ES', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    entry.innerHTML = `
      <span class="log-timestamp">[${timestamp}]</span>
      <span class="log-message">${escapeHtml(String(message))}</span>
    `;

    logsOutput.appendChild(entry);

    // Auto-scroll al final
    logsOutput.scrollTop = logsOutput.scrollHeight;

    // Abrir panel automáticamente si está colapsado y es error
    if (level === 'error' && logsPanel.classList.contains('collapsed')) {
      logsPanel.classList.remove('collapsed');
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ──────────────────────────────────────────────────────────────────
  // Interceptar console.log, console.warn, console.error
  // ──────────────────────────────────────────────────────────────────
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = function(...args) {
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');

    appendLog('info', message);
    originalLog.apply(console, args);
  };

  console.warn = function(...args) {
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');

    appendLog('warn', message);
    originalWarn.apply(console, args);
  };

  console.error = function(...args) {
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');

    appendLog('error', message);
    originalError.apply(console, args);
  };

  // ──────────────────────────────────────────────────────────────────
  // Exponer función global para agregar logs desde otros módulos
  // ──────────────────────────────────────────────────────────────────
  window.addLog = appendLog;

  // ──────────────────────────────────────────────────────────────────
  // Log inicial
  // ──────────────────────────────────────────────────────────────────
  appendLog('info', '✓ Panel de logs inicializado - Presiona Ctrl+` para abrir/cerrar');

})();
