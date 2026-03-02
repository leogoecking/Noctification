@echo off
setlocal

REM === Config ===
set PORT=8765
set URL=http://127.0.0.1:%PORT%/index.html

REM Vai para a pasta do .bat
cd /d "%~dp0"

REM Sobe o servidor em background (sem travar o terminal)
start "" /min cmd /c "python -m http.server %PORT% --bind 127.0.0.1"

REM Espera 1s pro servidor subir
timeout /t 1 /nobreak >nul

REM Abre no navegador padrão
start "" "%URL%"

echo Lembretes NOC iniciado em %URL%
endlocal