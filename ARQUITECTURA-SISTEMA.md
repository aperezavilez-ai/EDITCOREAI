# ARQUITECTURA DEL SISTEMA EDITCOREAI

## 1. ESTRUCTURA DE PROYECTOS

### Ubicación global
**Todos los proyectos están en:** `D:\PROGRAMAS IA\`

Cada carpeta es un proyecto independiente con:
- Repositorio Git (conectado a GitHub `aperezavilez-ai/*`)
- Deploy en Vercel (auto-deploy desde GitHub)
- Base de datos en Supabase (`supabase.gafcore.com`)

### Ejemplo de proyecto típico
```
D:\PROGRAMAS IA\TAXIDRIV\
├── .git/                    # Repo git
├── .vercel/                 # Config Vercel
├── package.json             # Dependencias
├── vercel.json              # Config deploy
├── supabase/                # Migraciones DB
│   └── migrations/
└── src/                     # Código fuente
```

## 2. CONEXIONES Y CREDENCIALES

### GitHub
- **Owner:** `aperezavilez-ai`
- **Autenticación:** Token almacenado en vault de EDITCOREAI
- **Location:** `runtime/cloud-vault-bridge.js` maneja las conexiones

### Vercel
- **Account:** Personal (aperezavilez)
- **Projects:** Auto-deploy desde GitHub
- **Auth:** Token en vault
- **Deploy:** Push a `main` → auto-deploy

### Supabase
- **Host:** `supabase.gafcore.com`
- **Projects:** Un proyecto por app
- **Auth:** Service keys en vault
- **Acceso:** `runtime/supabase-client.js`

## 3. HERRAMIENTAS INTERNAS DE EDITCOREAI

### Brain-seed (Cerebro persistente)
- **Location:** `brain-seed/`
- **Función:** Memoria de conocimiento, patrones, decisiones pasadas
- **Acceso:** `brain-service.js`, `brain-memory-store.js`

### Cloud Vault (Credenciales)
- **Location:** `runtime/cloud-vault-bridge.js`
- **Almacena:** 
  - GitHub tokens
  - Vercel tokens
  - Supabase keys
  - SSH keys
- **Encriptación:** `safeStorage` de Electron
- **Acceso:** Solo a través del vault bridge

### Project Infra (`.editcore/`)
- Cada proyecto puede tener `.editcore/` con:
  - `manifest.json` - Config del proyecto
  - `vault.json` - Secrets locales del proyecto
  - `deploy-config.json` - Config de deploy

## 4. FLUJO DE DEPLOY

### Deploy estándar
1. Usuario pide "publica en vercel"
2. EDITCOREAI:
   a. Lee credenciales de vault
   b. Verifica git status
   c. Commit + push a GitHub
   d. Vercel detecta push → auto-deploy
   e. Monitorea el deploy

### Deploy con Supabase
1. Si hay migraciones en `supabase/migrations/`
2. EDITCOREAI:
   a. Conecta a Supabase
   b. Aplica migraciones pendientes
   c. Verifica integridad de tablas
   d. Luego hace deploy web

## 5. CÓMO RESTAURAR UN PROYECTO ROTO

### Si el login dejó de funcionar

**Diagnóstico:**
1. Verificar qué cambió: `git diff HEAD~1`
2. Ver logs de Vercel: `runtime/vercel-client.js` tiene `getDeploymentLogs()`
3. Revisar errores de Supabase: `supabase-client.js` tiene `checkMigrations()`

**Restauración:**
```bash
# 1. Ver qué commit rompió
git log --oneline -10

# 2. Crear branch de respaldo
git checkout -b backup-before-fix

# 3. Volver al commit funcional
git checkout <commit-hash-funcional>

# 4. Verificar que funciona
npm run dev  # o npm start

# 5. Si funciona, merge selectivo
git checkout main
git revert <commit-malo>
git push origin main
```

**Rollback en Vercel:**
- Vercel UI → Deployments → Click en el deploy funcional → "Promote to Production"
- O desde EDITCOREAI: `runtime/vercel-client.js` → `promoteDeployment(deploymentId)`

## 6. ANTI-PATRONES (LO QUE ROMPE PROYECTOS)

### ❌ NO HACER:
1. **No cambiar auth sin backup** - Siempre hacer snapshot antes
2. **No tocar `.env` sin verificar** - Las variables deben estar en vault
3. **No hacer commits masivos sin revisar** - Dividir en commits pequeños
4. **No deployar sin tests** - Verificar localmente primero
5. **No modificar migraciones ya aplicadas** - Crear nuevas migraciones

### ✅ SÍ HACER:
1. **Verificar git status antes** - Saber qué va a cambiar
2. **Crear branch para cambios grandes** - No en `main` directo
3. **Probar localmente** - `npm run dev` antes de deploy
4. **Guardar snapshot** - `git stash` o branch de respaldo
5. **Deploy incremental** - Un feature a la vez

## 7. COMANDOS DE EMERGENCIA

### Restaurar proyecto desde GitHub
```bash
cd "D:\PROGRAMAS IA\<PROYECTO>"
git fetch origin
git reset --hard origin/main
npm install
```

### Restaurar base de datos Supabase
```javascript
// Desde EDITCOREAI, con el proyecto abierto:
const { supabaseClient } = require('./runtime/supabase-client');
const client = await supabaseClient.connect(projectRoot);
await client.rollbackToSnapshot('antes-del-fix');
```

### Ver qué rompió el deploy
```javascript
// Desde EDITCOREAI:
const { vercelClient } = require('./runtime/vercel-client');
const logs = await vercelClient.getDeploymentLogs(deploymentId);
console.log(logs.stderr);  // Errores
```

## 8. FLUJO DE TRABAJO SEGURO

### Para modificar un proyecto funcional:

1. **ANTES de tocar código:**
   ```bash
   git checkout -b feature/<nombre>
   git add -A
   git commit -m "snapshot: antes de cambios en login"
   ```

2. **Durante el cambio:**
   - Hacer commit cada 10-15 minutos
   - Probar localmente después de cada cambio
   - No hacer "corregir todo" de una vez

3. **DESPUÉS del cambio:**
   ```bash
   npm test  # Si hay tests
   npm run dev  # Verificar en local
   git push origin feature/<nombre>
   ```

4. **Deploy:**
   - Hacer PR en GitHub
   - Deploy preview en Vercel (automático)
   - Verificar preview
   - Si funciona: merge a main
   - Si falla: revisar logs, revertir branch

## 9. ARQUITECTURA EDITCOREAI (SELF-AWARENESS)

### Componentes clave que debe conocer:

1. **editcore-chat-kernel/** - El cerebro del agente
   - `classify.js` - Clasificador de intenciones
   - `orchestrator.js` - Orquestador de subagentes
   - `tools.js` - Herramientas disponibles

2. **runtime/** - Servicios del sistema
   - `intent-orchestrator.js` - Orquestador completo
   - `editcore-claude-adapter.js` - Adaptador del modelo
   - `cloud-vault-bridge.js` - Gestor de credenciales
   - `vercel-client.js` - Cliente de Vercel
   - `supabase-client.js` - Cliente de Supabase

3. **brain-seed/** - Memoria persistente
   - Conocimiento acumulado
   - Patrones de proyectos
   - Decisiones pasadas

### Cómo EDITCOREAI debe operar:

**ANTES de hacer cambios:**
1. Leer ROADMAP.md del proyecto
2. Ver git log reciente
3. Verificar qué está deployado en Vercel
4. Revisar estado de Supabase

**DURANTE los cambios:**
1. Commits incrementales
2. Verificación local continua
3. No tocar archivos críticos (auth, db) sin confirmación

**DESPUÉS de los cambios:**
1. Verificar que funciona localmente
2. Push a branch feature
3. Deploy preview
4. Merge solo si preview funciona

## 10. RECUPERACIÓN DEL PROYECTO ROTO ACTUAL

### Pasos inmediatos:

1. **Identificar el proyecto:**
   ```bash
   cd "D:\PROGRAMAS IA\<PROYECTO_ROTO>"
   git log --oneline -20  # Ver commits recientes de EDITCORE
   ```

2. **Ver qué rompió:**
   ```bash
   git show <commit-editcore>  # Ver cambios exactos
   ```

3. **Rollback:**
   ```bash
   git revert <commit-editcore>  # Revertir cambios
   git push origin main
   ```

4. **Verificar Vercel:**
   - Ir a vercel.com/aperezavilez-4333s/projects/<proyecto>
   - Ver deployment funcional anterior
   - Promote to Production

5. **Si la DB se rompió:**
   ```bash
   cd supabase/
   # Ver migraciones aplicadas
   # Crear migración de rollback si es necesario
   ```

