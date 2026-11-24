# CORRECCIÓN 1 — RUTEO DE NEXUS (auditoría 2026-11-24)

Paquete de corrección, NO es una versión nueva: EditCoreAI sigue en 5.3.3.
Corrige lo que tú señalaste: Nexus debía escalar al máximo vía Groq y no estaba sucediendo.

## Qué corrige (y solo esto)

1. **La llave de Groq ahora sale de la configuración de la propia app.**
   Antes el kernel solo la encontraba en el `.env` de EDITCORE-MODEL (otro proyecto)
   o en el entorno del proceso. Ahora main la resuelve desde la bóveda de EditCoreAI
   y la entrega al kernel en cada turno; el kernel además acepta la llave del propio
   turno si ya es de Groq y la de un perfil Groq configurado. La ruta al `.env` de
   EDITCORE-MODEL se eliminó.
2. **La escalera de respaldos va de mayor a menor:** principal → 120B → 20B → local.
   Antes el primer respaldo era el 20B (el chico) y el 120B quedaba detrás.
3. **La degradación ya no es silenciosa.** Cada turno Nexus declara su ruta
   (destino, fuente de la llave, si corrió degradado) y queda anotada en
   `.editcore/turnos.jsonl` en el evento `fin_turno`.

## Archivos (conteos de líneas para verificar, conteo PowerShell)

| Archivo | Líneas |
|---|---|
| main.js | 11725 |
| runtime/chat-kernel-bridge.js | 332 |
| runtime/tools/index.js | 379 |
| runtime/tools/nuevo/adaptador.js | 1022 |
| test/nexus-hybrid-routing.test.js | 42 |
| test/nexus-ruteo-correccion1.test.js | 150 (nuevo) |

## Verificado por Lu en el clon antes de empaquetar

- La batería nueva replica el fallo: 7/7 en rojo contra el código actual.
- Con la corrección: batería nueva 7/7 + prueba de ruteo híbrido 1/1 = **8/8 en verde**.
- Suite completa: **1.194 tests, 1.157 pasan**; los 24 fallos y 8 cancelados son
  exactamente los mismos de antes de la corrección (comparados nombre por nombre
  contra la base: cero regresiones). La prueba de ruteo híbrido, que antes dependía
  de la máquina, ahora es hermética y pasa.

## Aplicación

**BLOQUE 1 — SE CORRE (respaldo, desde la carpeta de EditCoreAI):**

```powershell
cd "D:\PROGRAMAS IA\EDITCOREAI"
git checkout -b backup/correccion1-ruteo-nexus
git checkout main
```

**BLOQUE 2 — SE CORRE (extraer el ZIP ENCIMA de la carpeta, respetando las rutas):**

```powershell
Expand-Archive .\editcoreai-correccion1-ruteo-nexus.zip -DestinationPath . -Force
```

**BLOQUE 3 — SE CORRE (compuerta de sintaxis, obligatoria):**

```powershell
node --check main.js
node --check runtime\chat-kernel-bridge.js
node --check runtime\tools\index.js
node --check runtime\tools\nuevo\adaptador.js
```

Si alguno imprime un error, detente y pégame esa salida. Si no imprime nada, sigue.

**BLOQUE 4 — SE CORRE (la batería de la corrección):**

```powershell
node --test test\nexus-ruteo-correccion1.test.js test\nexus-hybrid-routing.test.js
```

Esperado: `pass 8`, `fail 0`. Si un número no cuadra, pégame solo esa salida.

## Juicio en vivo (lo único que cierra esta corrección)

1. **Una sola vez:** guarda tu llave de Groq en la configuración de proveedores
   de la propia EditCoreAI (la pantalla donde se guardan las llaves de los
   proveedores). Si esa pantalla no te la acepta, la vía segura es crear el
   archivo `.env` en la raíz de EditCoreAI con una línea `GROQ_API_KEY=tu_llave`.
   Ya NO depende del `.env` de EDITCORE-MODEL.
2. Abre la app, elige Nexus y manda un encargo real en un proyecto.
3. **BLOQUE 5 — SOLO LECTURA, SE CORRE y se pega la salida** (en la carpeta del
   proyecto donde mandaste el encargo):

```powershell
Get-Content .editcore\turnos.jsonl -Tail 5 | Select-String "fin_turno"
```

En esa línea debe venir `"ruta":{"destino":"groq",...,"degradado":false}`.
Si dice `"destino":"local","degradado":true`, la llave no quedó guardada donde
la app la lee — pégame la línea y lo resolvemos desde ahí, sin otro paquete a ciegas.
