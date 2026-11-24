# ============================================================
# APLICAR CORRECCION 1 - RUTEO DE NEXUS (auditoria 2026-11-24)
# Este script invoca TODO: respaldo, conteos, sintaxis y bateria.
# Luis solo extrae el ZIP encima de la carpeta de EditCoreAI y
# corre este script desde esa carpeta. Si un paso no cuadra, el
# script se detiene y dice exactamente que salida pegar de vuelta.
# (Sin acentos a proposito: PowerShell 5.1 y la codificacion.)
# ============================================================
$ErrorActionPreference = "Continue"
$paso = 0
function Paso($texto) { $script:paso++; Write-Host ""; Write-Host "=== PASO $script:paso - $texto ===" }
function Falla($texto) { Write-Host ""; Write-Host "DETENIDO EN EL PASO $script:paso - $texto" -ForegroundColor Red; Write-Host "Pega esta salida completa en el chat y no sigas."; exit 1 }

Paso "Ubicacion: debe ser la raiz de EditCoreAI"
if (-not (Test-Path ".\package.json") -or -not (Test-Path ".\main.js") -or -not (Test-Path ".\runtime\tools\nuevo\adaptador.js")) {
  Falla "no estoy en la carpeta de EditCoreAI. Corre: cd 'D:\PROGRAMAS IA\EDITCOREAI' y vuelve a correr el script."
}
Write-Host "OK: raiz de EditCoreAI confirmada."

Paso "Respaldo: rama con el codigo anterior (queda en el HEAD actual)"
$rama = "backup/correccion1-ruteo-nexus"
git rev-parse --verify $rama 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { $rama = "backup/correccion1-ruteo-nexus-" + (Get-Date -Format "HHmmss") }
git branch $rama
if ($LASTEXITCODE -ne 0) { Falla "git no pudo crear la rama de respaldo." }
Write-Host "OK: respaldo en la rama $rama (restaurar: git checkout $rama -- main.js runtime test)"

Paso "Conteos de lineas de los 6 archivos del paquete"
$esperados = @(
  @("main.js", 11725),
  @("runtime\chat-kernel-bridge.js", 332),
  @("runtime\tools\index.js", 379),
  @("runtime\tools\nuevo\adaptador.js", 1022),
  @("test\nexus-hybrid-routing.test.js", 42),
  @("test\nexus-ruteo-correccion1.test.js", 150)
)
$mal = 0
foreach ($e in $esperados) {
  if (-not (Test-Path $e[0])) { Write-Host "FALTA: $($e[0])" -ForegroundColor Red; $mal++; continue }
  $n = (Get-Content $e[0]).Count
  if ($n -eq $e[1]) { Write-Host "OK: $($e[0]) = $n" } else { Write-Host "NO CUADRA: $($e[0]) = $n (esperado $($e[1]))" -ForegroundColor Red; $mal++ }
}
if ($mal -gt 0) { Falla "$mal archivo(s) no cuadran: el ZIP no se extrajo completo o se extrajo en otra carpeta." }
Write-Host "OK: 6/6 conteos cuadran."

Paso "Compuerta de sintaxis (node --check)"
foreach ($f in @("main.js", "runtime\chat-kernel-bridge.js", "runtime\tools\index.js", "runtime\tools\nuevo\adaptador.js")) {
  node --check $f
  if ($LASTEXITCODE -ne 0) { Falla "error de sintaxis en $f (la salida de arriba es la que hay que pegar)." }
  Write-Host "OK: $f"
}

Paso "Bateria de la correccion (esperado: pass 8, fail 0)"
$salida = node --test test\nexus-ruteo-correccion1.test.js test\nexus-hybrid-routing.test.js 2>&1
$salida | Select-Object -Last 12
if ($LASTEXITCODE -ne 0) { Falla "la bateria no quedo en verde (la salida de arriba es la que hay que pegar)." }
Write-Host ""
Write-Host "============================================================"
Write-Host "CORRECCION 1 APLICADA Y VERIFICADA EN ESTA MAQUINA."
Write-Host "Sigue el juicio en vivo del LEEME: guarda tu llave de Groq en"
Write-Host "la configuracion de proveedores de EditCoreAI, manda un encargo"
Write-Host "real con Nexus y revisa la ruta en .editcore\turnos.jsonl"
Write-Host "del proyecto (fin_turno debe decir destino groq, degradado false)."
Write-Host "============================================================"
