# ============================================================
# VERIFICAR RUTA - CORRECCION 1 (auditoria 2026-11-24)
# Lee el .editcore\turnos.jsonl de ESTA carpeta, toma el ultimo
# fin_turno y dicta el veredicto de la ruta de Nexus.
# SOLO LECTURA: no modifica nada.
# (Sin acentos a proposito: PowerShell 5.1 y la codificacion.)
# ============================================================
$ErrorActionPreference = "Continue"
$archivo = ".\.editcore\turnos.jsonl"
if (-not (Test-Path $archivo)) {
  Write-Host "DETENIDO: no existe .editcore\turnos.jsonl en esta carpeta." -ForegroundColor Red
  Write-Host "Corre el script desde la carpeta del proyecto donde mandaste el encargo."
  exit 1
}
$item = Get-Item $archivo
Write-Host "Ultima escritura del registro: $($item.LastWriteTime)"
$ultimo = $null
foreach ($linea in (Get-Content $archivo)) {
  try {
    $o = $linea | ConvertFrom-Json
    if ($o.tipo -eq "fin_turno") { $ultimo = $o }
  } catch { }
}
if (-not $ultimo) {
  Write-Host "DETENIDO: el registro no tiene ningun fin_turno." -ForegroundColor Red
  exit 1
}
Write-Host "Ultimo fin_turno: $($ultimo.ts) - carril $($ultimo.carril)"
if (-not $ultimo.ruta) {
  Write-Host "VEREDICTO: ese turno es de ANTES de la correccion (no trae el campo ruta)." -ForegroundColor Yellow
  Write-Host "Manda un encargo nuevo con la app ya corregida y vuelve a correr este script."
  exit 1
}
Write-Host "Ruta: destino=$($ultimo.ruta.destino) | fuenteLlave=$($ultimo.ruta.fuenteLlave) | degradado=$($ultimo.ruta.degradado)"
if ($ultimo.ruta.destino -eq "groq" -and -not $ultimo.ruta.degradado) {
  Write-Host "VEREDICTO: CORRECCION 1 CERRADA EN VIVO - Nexus escalo a Groq con la llave de la app." -ForegroundColor Green
} elseif ($ultimo.ruta.degradado) {
  Write-Host "VEREDICTO: el turno corrio LOCAL y lo DECLARO (ya no es silencioso):" -ForegroundColor Yellow
  Write-Host "  $($ultimo.ruta.motivo)"
  Write-Host "La llave no llego al ruteo: corre preparar-juicio-correccion1.ps1 y repite el encargo."
} else {
  Write-Host "VEREDICTO: destino $($ultimo.ruta.destino). Manda un encargo de texto (sin imagenes) para juzgar la ruta Groq." -ForegroundColor Yellow
}
