@echo off
title Catalogo CNC - Ambar del Sur y Guissel
cd /d "%~dp0"
echo ======================================================================
echo   Iniciando Catalogo CNC en http://localhost:8090 ...
echo ======================================================================

python -c "import fastapi, uvicorn, pydantic" 2>nul
if errorlevel 1 (
    echo [*] Instalando dependencias necesarias (fastapi, uvicorn, pillow)...
    pip install fastapi uvicorn python-multipart pillow
)

start "" http://localhost:8090
python -m uvicorn app.main:app --host 127.0.0.1 --port 8090
pause
