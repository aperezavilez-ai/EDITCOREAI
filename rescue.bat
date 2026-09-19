@echo off
title EDITCOREAI - Auto-Recuperacion de Emergencia
chcp 65001 >nul
echo ====================================================
echo 🛡️  EDITCOREAI - AUTO-RECUPERACION Y RESCATE 1-CLIC
echo ====================================================
echo.
echo Restaurando el ultimo estado funcional verificado...
echo.

node "%~dp0scripts\failsafe-recovery.js"

echo.
echo ====================================================
echo Presiona cualquier tecla para cerrar esta ventana...
echo ====================================================
pause >nul
