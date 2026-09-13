@echo off
setlocal
cd /d "%~dp0"

REM Solo esta carpeta: D:\PROGRAMAS IA\EDITCOREAI
REM Abre SIEMPRE el launcher EDITCOREAI.exe (logo oficial), NUNCA electron.exe suelto.

set "EDITCORE_USER_DATA_PATH=%APPDATA%\EDITCOREAI"
set "ELECTRON_FORCE_IS_PACKAGED="

echo Carpeta: %cd%
echo Datos:   %EDITCORE_USER_DATA_PATH%
echo.

if /I not "%cd%"=="D:\PROGRAMAS IA\EDITCOREAI" (
  echo AVISO: no estas en D:\PROGRAMAS IA\EDITCOREAI
  echo Ruta actual: %cd%
)

if not exist "main.js" (
  echo ERROR: falta main.js
  pause
  exit /b 1
)
if not exist "editcore-chat-kernel\index.js" (
  echo ERROR: falta editcore-chat-kernel en EDITCOREAI
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo ERROR: falta Electron. Ejecuta: npm install
  pause
  exit /b 1
)
if not exist "assets\logo.ico" (
  if exist "resources\ui-overlay\assets\logo.ico" (
    if not exist "assets" mkdir "assets"
    copy /Y "resources\ui-overlay\assets\logo.ico" "assets\logo.ico" >nul
  )
)

REM Branding permanente: electron.exe = icono + nombre EditCoreAI (nunca logo Electron).
node "scripts\brand-electron-runtime.js" >nul 2>nul

if not exist "EDITCOREAI.exe" (
  echo Recompilando EDITCOREAI.exe con logo oficial...
  node "scripts\rebuild-root-exe.js"
  if errorlevel 1 (
    echo ERROR: no se pudo crear EDITCOREAI.exe
    pause
    exit /b 1
  )
)

REM Accesos directos Escritorio/Inicio con icono oficial (silencioso).
node "scripts\ensure-editcore-shortcuts.js" >nul 2>nul

start "" "%~dp0EDITCOREAI.exe"
endlocal
