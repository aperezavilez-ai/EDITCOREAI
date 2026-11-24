# ============================================================
# APLICAR CORRECCION 2 - MOTOR DE SUBAGENTES REALES
# (auditoria 2026-11-24). Descarga los 7 archivos corregidos,
# verifica conteos, sintaxis y las baterias C2 + C1 (blindaje).
# Se detiene si algo no cuadra y dice que salida pegar.
# Las baterias corren UNA POR UNA (en serie): C1 y C2 apartan
# el .env de la raiz al correr y no deben pisarse entre si.
# La bateria C2 tarda ~10 s (prueba la ventana del Cerebro).
# (Sin acentos a proposito: PowerShell 5.1 y la codificacion.)
# ============================================================
$ErrorActionPreference = "Continue"
function Falla($t) { Write-Host ""; Write-Host "DETENIDO - $t" -ForegroundColor Red; Write-Host "Pega esta salida completa en el chat y no sigas."; exit 1 }

if (-not (Test-Path ".\package.json") -or -not (Test-Path ".\runtime\tools\nuevo\adaptador.js")) {
  Falla "no estoy en la carpeta de EditCoreAI. Corre: cd 'D:\PROGRAMAS IA\EDITCOREAI'"
}

$archivos = @(
  @{ Url = "https://muse.ai/files/1460310000498683/3714477655369550/0speaukdkye5l32lphs7d3az/subagentes.js"; Destino = ".\runtime\tools\nuevo\subagentes.js"; Lineas = 206 },
  @{ Url = "https://muse.ai/files/1460310000498683/1891212095577562/klpr6sjwc7ul9w9d4u9q5xlj/adaptador.js"; Destino = ".\runtime\tools\nuevo\adaptador.js"; Lineas = 1102 },
  @{ Url = "https://muse.ai/files/1460310000498683/1819768772593309/9p1kxdokqekj9dryjrqdi5ss/textos.js"; Destino = ".\runtime\tools\nuevo\textos.js"; Lineas = 231 },
  @{ Url = "https://muse.ai/files/1460310000498683/1815702439684149/16zboifzkzsfolrogipaq8cj/turno.js"; Destino = ".\runtime\tools\nuevo\turno.js"; Lineas = 384 },
  @{ Url = "https://muse.ai/files/1460310000498683/1878933393362936/8n1t3k72oqpln4wz787araza/parallel-delegate.js"; Destino = ".\runtime\tools\parallel-delegate.js"; Lineas = 179 },
  @{ Url = "https://muse.ai/files/1460310000498683/2034137560472671/edzfvdkk008u4i2how83nfi3/index.js"; Destino = ".\runtime\tools\index.js"; Lineas = 391 },
  @{ Url = "https://muse.ai/files/1460310000498683/1851234972663407/x4dx3buoo4bcs951luzb218h/nexus-subagentes-correccion2.test.js"; Destino = ".\test\nexus-subagentes-correccion2.test.js"; Lineas = 277 }
)

Write-Host "=== Respaldando y descargando los archivos corregidos ==="
foreach ($a in $archivos) {
  if (Test-Path $a.Destino) { Copy-Item $a.Destino "$($a.Destino).bak-c2" -Force }
  Invoke-WebRequest -Uri $a.Url -OutFile $a.Destino -UseBasicParsing
}

Write-Host "=== Conteos (esperado: 206 / 1102 / 231 / 384 / 179 / 391 / 277) ==="
foreach ($a in $archivos) {
  $n = (Get-Content $a.Destino).Count
  Write-Host "$($a.Destino) = $n"
  if ($n -ne $a.Lineas) { Falla "el conteo de $($a.Destino) no cuadra: la descarga no llego completa." }
}

Write-Host "=== Sintaxis (6 archivos de codigo) ==="
foreach ($a in $archivos[0..5]) {
  node --check $a.Destino
  if ($LASTEXITCODE -ne 0) { Falla "error de sintaxis en $($a.Destino)." }
  Write-Host "OK: $($a.Destino)"
}

Write-Host "=== Bateria C2 - subagentes reales (esperado: pass 7, fail 0 - tarda ~10 s) ==="
node --test test\nexus-subagentes-correccion2.test.js 2>&1 | Select-Object -Last 8
if ($LASTEXITCODE -ne 0) { Falla "la bateria C2 no quedo en verde." }

Write-Host "=== Bateria C1 - blindaje del ruteo (esperado: pass 8, fail 0) ==="
node --test test\nexus-ruteo-correccion1.test.js 2>&1 | Select-Object -Last 8
if ($LASTEXITCODE -ne 0) { Falla "la bateria C1 no quedo en verde: la Correccion 1 se habria roto." }

Write-Host "=== Bateria de ruteo hibrido (esperado: pass 1, fail 0) ==="
node --test test\nexus-hybrid-routing.test.js 2>&1 | Select-Object -Last 8
if ($LASTEXITCODE -ne 0) { Falla "la bateria de ruteo hibrido no quedo en verde." }

Write-Host ""
Write-Host "============================================================"
Write-Host "CORRECCION 2 APLICADA Y VERIFICADA EN ESTA MAQUINA."
Write-Host "Juicio en vivo: cierra la app por completo y abrela de"
Write-Host "nuevo. Con un proyecto abierto, escribele a Nexus un"
Write-Host "encargo con varios frentes SIN usar las palabras"
Write-Host "subagente/delega/paralelo, por ejemplo:"
Write-Host "  revisa el proyecto completo: su estructura, su"
Write-Host "  seguridad y sus datos, y dime como esta cada frente"
Write-Host "Nexus debe repartir el trabajo entre especialistas y"
Write-Host "cerrar citando lo que cada frente encontro."
Write-Host "============================================================"
