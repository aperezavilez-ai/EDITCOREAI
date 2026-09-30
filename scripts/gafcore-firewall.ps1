# Bloquea desde la red (Wi-Fi/Ethernet) los servicios locales de Supabase y baas publicados por Docker.
# El acceso por localhost no se filtra; 54321 (proxy del watchdog, origen del túnel) queda abierto.
# Requiere administrador. Idempotente: recrea la regla en cada ejecución.
param([string]$LogPath = "")

$ErrorActionPreference = "Stop"
$group = "GAFCORE"
$name = "GAFCORE: bloquear servicios locales desde la red"
$ports = @("3000", "5432", "9000-9001", "54322-54329")
$interfaces = @(Get-NetAdapter -Physical | Select-Object -ExpandProperty Name)

try {
  Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $name -Group $group -Direction Inbound -Protocol TCP `
    -LocalPort $ports -InterfaceAlias $interfaces -Action Block -Profile Any | Out-Null
  $result = "OK regla '$name' puertos=$($ports -join ',') interfaces=$($interfaces -join ',')"
} catch {
  $result = "ERROR $($_.Exception.Message)"
}
if ($LogPath) { Set-Content -Path $LogPath -Value $result -Encoding UTF8 }
Write-Output $result
