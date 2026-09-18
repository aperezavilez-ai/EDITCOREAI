/**
 * Script de verificación del Dashboard de Auto-Evolución
 * Confirma que todos los componentes del Ciclo 11 están correctamente integrados
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Verificando Dashboard de Auto-Evolución...\n');

const checks = [];

// 1. Verificar que evolution-state.json existe y tiene la estructura correcta
try {
  const statePath = path.join(__dirname, 'auto-evolution', 'evolution-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  
  checks.push({
    name: 'evolution-state.json existe',
    passed: true
  });
  
  checks.push({
    name: 'Estado de ciclo registrado',
    passed: state.cycle >= 11 && state.status === 'PRODUCTION_READY'
  });
  
  checks.push({
    name: 'Observabilidad habilitada',
    passed: state.observability?.dashboard_enabled === true
  });
  
  checks.push({
    name: 'Tests verificados',
    passed: state.tests_verified?.runtime_tests === '24/24 passing'
  });
  
} catch (error) {
  checks.push({
    name: 'evolution-state.json existe',
    passed: false,
    error: error.message
  });
}

// 2. Verificar que el HTML del panel existe
try {
  const htmlPath = path.join(__dirname, '..', 'ide', 'auto-evolution-panel.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  
  checks.push({
    name: 'Panel HTML existe',
    passed: true
  });
  
  checks.push({
    name: 'Panel usa electronAPI',
    passed: htmlContent.includes('window.electronAPI.getEvolutionState')
  });
  
  checks.push({
    name: 'Botón de ejecución manual presente',
    passed: htmlContent.includes('run-cycle-btn')
  });
  
  checks.push({
    name: 'Auto-refresh implementado',
    passed: htmlContent.includes('setInterval(loadEvolutionState, 30000)')
  });
  
} catch (error) {
  checks.push({
    name: 'Panel HTML existe',
    passed: false,
    error: error.message
  });
}

// 3. Verificar que preload.js expone los canales IPC
try {
  const preloadPath = path.join(__dirname, '..', 'preload.js');
  const preloadContent = fs.readFileSync(preloadPath, 'utf8');
  
  checks.push({
    name: 'preload.js expone electronAPI',
    passed: preloadContent.includes('contextBridge.exposeInMainWorld("electronAPI"')
  });
  
  checks.push({
    name: 'Canal evolution:get-state expuesto',
    passed: preloadContent.includes('evolution:get-state')
  });
  
  checks.push({
    name: 'Canal evolution:run-cycle expuesto',
    passed: preloadContent.includes('evolution:run-cycle')
  });
  
} catch (error) {
  checks.push({
    name: 'preload.js expone electronAPI',
    passed: false,
    error: error.message
  });
}

// 4. Verificar que main.js tiene los handlers IPC
try {
  const mainPath = path.join(__dirname, '..', 'main.js');
  const mainContent = fs.readFileSync(mainPath, 'utf8');
  
  checks.push({
    name: 'Handler evolution:get-state implementado',
    passed: mainContent.includes('ipcMain.handle("evolution:get-state"')
  });
  
  checks.push({
    name: 'Handler evolution:run-cycle implementado',
    passed: mainContent.includes('ipcMain.handle("evolution:run-cycle"')
  });
  
  checks.push({
    name: 'Handler evolution:open-dashboard implementado',
    passed: mainContent.includes('ipcMain.handle("evolution:open-dashboard"')
  });
  
} catch (error) {
  checks.push({
    name: 'Handlers IPC en main.js',
    passed: false,
    error: error.message
  });
}

// Mostrar resultados
console.log('📊 Resultados de la verificación:\n');

let passed = 0;
let failed = 0;

checks.forEach(check => {
  const icon = check.passed ? '✅' : '❌';
  console.log(`${icon} ${check.name}`);
  
  if (check.error) {
    console.log(`   Error: ${check.error}`);
  }
  
  check.passed ? passed++ : failed++;
});

console.log(`\n📈 Total: ${passed}/${checks.length} checks pasados`);

if (failed === 0) {
  console.log('\n🎉 Dashboard de Auto-Evolución completamente integrado y verificado');
  process.exit(0);
} else {
  console.log(`\n⚠️  ${failed} checks fallaron`);
  process.exit(1);
}
