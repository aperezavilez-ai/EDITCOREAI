@echo off
setlocal
REM Portable dentro de la carpeta del proyecto EDITCOREAI
cd /d "%~dp0release-EDITCOREAI\EDITCOREAI-portable"
if not exist "EDITCOREAI.exe" (
  echo ERROR: falta release-EDITCOREAI\EDITCOREAI-portable\EDITCOREAI.exe
  echo Ejecuta: npm run dist:win
  pause
  exit /b 1
)
start "" "EDITCOREAI.exe"
endlocal
