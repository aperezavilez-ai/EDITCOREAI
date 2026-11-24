# ============================================================
# PREPARAR JUICIO - CORRECCION 1 (auditoria 2026-11-24)
# Guarda la llave de Groq en el .env de la RAIZ de EditCoreAI,
# que es una de las fuentes que el ruteo corregido lee.
# Pide la llave por pantalla y NUNCA la imprime.
# (Sin acentos a proposito: PowerShell 5.1 y la codificacion.)
# ============================================================
$ErrorActionPreference = "Continue"
if (-not (Test-Path ".\package.json") -or -not (Test-Path ".\main.js")) {
  Write-Host "DETENIDO: corre este script desde la carpeta de EditCoreAI (D:\PROGRAMAS IA\EDITCOREAI)." -ForegroundColor Red
  exit 1
}
$llave = Read-Host "Pega tu llave de Groq (empieza con gsk_) y Enter"
$llave = "$llave".Trim()
if (-not $llave.StartsWith("gsk_")) {
  Write-Host "DETENIDO: eso no parece una llave de Groq (debe empezar con gsk_). No se escribio nada." -ForegroundColor Red
  exit 1
}
$lineas = @()
if (Test-Path ".\.env") {
  $lineas = @(Get-Content ".\.env" | Where-Object { $_ -notmatch "^\s*GROQ_API_KEY\s*=" })
}
$lineas += "GROQ_API_KEY=$llave"
Set-Content -Path ".\.env" -Value $lineas -Encoding ASCII
Write-Host "OK: llave guardada en el .env de la raiz de EditCoreAI. Su valor no se imprimio."
Write-Host ""
Write-Host "AHORA: abre la app EditCoreAI (si estaba abierta, cierrala y abrela),"
Write-Host "deja abierto como proyecto esta misma carpeta, manda a Nexus el"
Write-Host "encargo: 'revisa este proyecto y dime que es y que le falta',"
Write-Host "espera la respuesta completa y corre: .\verificar-ruta-correccion1.ps1"
