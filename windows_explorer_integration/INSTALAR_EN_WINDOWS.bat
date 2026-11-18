@echo off
title Instalar Integracion Windows Explorer (.nc / .c2d) + UGS
cd /d "%~dp0"
echo ======================================================================
echo   Instalando Extension del Explorador de Windows y Boton Abrir en UGS
echo ======================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar_integracion_windows.ps1"
