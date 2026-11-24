# ============================================================
# APLICAR PARCHE C1B - EL LECTOR DEL .ENV BUSCABA EN runtime/
# (auditoria 2026-11-24). Descarga los 2 archivos corregidos,
# verifica conteos, sintaxis y bateria. Se detiene si algo no
# cuadra y dice que salida pegar de vuelta.
# (Sin acentos a proposito: PowerShell 5.1 y la codificacion.)
# ============================================================
$ErrorActionPreference = "Continue"
function Falla($t) { Write-Host ""; Write-Host "DETENIDO - $t" -ForegroundColor Red; Write-Host "Pega esta salida completa en el chat y no sigas."; exit 1 }

if (-not (Test-Path ".\package.json") -or -not (Test-Path ".\runtime\tools\nuevo\adaptador.js")) {
  Falla "no estoy en la carpeta de EditCoreAI. Corre: cd 'D:\PROGRAMAS IA\EDITCOREAI'"
}
Write-Host "=== Descargando los archivos corregidos ==="
Copy-Item ".\runtime\tools\nuevo\adaptador.js" ".\runtime\tools\nuevo\adaptador.js.bak-c1" -Force
Invoke-WebRequest -Uri "https://muse.ai/files/1460310000498683/2040288933300269/gwwbgicj7twvtxkfwtrx3w88/adaptador.js" -OutFile ".\runtime\tools\nuevo\adaptador.js" -UseBasicParsing
Invoke-WebRequest -Uri "https://muse.ai/files/1460310000498683/2121488578728935/nm5bx8kyb5j3hushd7jdt0qp/nexus-ruteo-correccion1.test.js" -OutFile ".\test\nexus-ruteo-correccion1.test.js" -UseBasicParsing

Write-Host "=== Conteos (esperado: adaptador 1026, bateria 200) ==="
$n1 = (Get-Content ".\runtime\tools\nuevo\adaptador.js").Count
$n2 = (Get-Content ".\test\nexus-ruteo-correccion1.test.js").Count
Write-Host "adaptador.js = $n1 | nexus-ruteo-correccion1.test.js = $n2"
if ($n1 -ne 1026 -or $n2 -ne 200) { Falla "los conteos no cuadran: la descarga no llego completa." }

Write-Host "=== Sintaxis ==="
node --check runtime\tools\nuevo\adaptador.js
if ($LASTEXITCODE -ne 0) { Falla "error de sintaxis en adaptador.js." }
Write-Host "OK: adaptador.js"

Write-Host "=== Estado de la raiz (solo nombres, sin valores) ==="
Write-Host ".env existe: $(Test-Path .\.env) | .env.local existe: $(Test-Path .\.env.local) | GROQ_API_KEY en el entorno: $([bool]$env:GROQ_API_KEY)"
Write-Host "=== Bateria (esperado: pass 9, fail 0) ==="
$salida = node --test test\nexus-ruteo-correccion1.test.js test\nexus-hybrid-routing.test.js 2>&1
$salida | Select-Object -Last 10
if ($LASTEXITCODE -ne 0) { Falla "la bateria no quedo en verde." }
Write-Host ""
Write-Host "============================================================"
Write-Host "PARCHE C1B APLICADO Y VERIFICADO."
Write-Host "Ahora: cierra la app por completo y abrela de nuevo, manda"
Write-Host "el mismo encargo a Nexus y corre el verificador en la"
Write-Host "carpeta del proyecto abierto. Debe decir destino groq."
Write-Host "============================================================"
