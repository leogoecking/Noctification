@echo off
setlocal EnableExtensions

for %%I in ("%~dp0.") do set "APP_DIR=%%~fI"
pushd "%APP_DIR%" >nul 2>&1 || (
  echo [ERRO] Nao foi possivel acessar a pasta do projeto.
  exit /b 1
)

echo [1/4] Verificando Node.js e npm...
where node >nul 2>&1 || (
  echo [ERRO] Node.js nao encontrado. Instale em: https://nodejs.org/
  goto :fail
)
where npm >nul 2>&1 || (
  echo [ERRO] npm nao encontrado. Instale/reinstale o Node.js.
  goto :fail
)

for /f "delims=" %%V in ('node -v') do set "NODE_VER=%%V"
for /f "delims=" %%V in ('npm -v') do set "NPM_VER=%%V"
echo      Node: %NODE_VER%
echo      npm : %NPM_VER%

echo [2/4] Instalando dependencias (npm install)...
call npm install || goto :fail

echo [3/4] Configurando funcao "lembretes" no PowerShell profile...
set "TMP_PS=%TEMP%\lembretes_setup_%RANDOM%%RANDOM%.ps1"
> "%TMP_PS%" (
  echo $ErrorActionPreference = 'Stop'
  echo $appPath = '%APP_DIR%'
  echo $start = '# ^>^>^> LEMBRETES NOC ^>^>^>'
  echo $end = '# ^<^<^< LEMBRETES NOC ^<^<^<'
  echo if ^(-not ^(Test-Path $PROFILE^)^) { New-Item -ItemType File -Path $PROFILE -Force ^| Out-Null }
  echo $existing = Get-Content -Path $PROFILE -Raw -ErrorAction SilentlyContinue
  echo if ^($null -eq $existing^) { $existing = '' }
  echo $block = @'
  echo # ^>^>^> LEMBRETES NOC ^>^>^>
  echo function lembretes {
  echo   [CmdletBinding()]
  echo   param(
  echo     [switch]$Bg,
  echo     [switch]$Stop,
  echo     [switch]$Status,
  echo     [switch]$Open
  echo   )
  echo.
  echo   $AppPath = '__APP_PATH__'
  echo   $Port = 8765
  echo   $Url = "http://127.0.0.1:$Port/index.html"
  echo   $PidFile = Join-Path $env:LOCALAPPDATA 'lembretes-noc.pid'
  echo.
  echo   function Get-LembretesPid {
  echo     $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue ^| Select-Object -First 1
  echo     if ($conn) { return $conn.OwningProcess }
  echo     return $null
  echo   }
  echo.
  echo   if ($Status) {
  echo     $pid = Get-LembretesPid
  echo     if ($pid) { Write-Host "Rodando em $Url (PID $pid)" } else { Write-Host 'Parado' }
  echo     return
  echo   }
  echo.
  echo   if ($Stop) {
  echo     $pid = $null
  echo     if (Test-Path $PidFile) { $pid = Get-Content $PidFile -ErrorAction SilentlyContinue }
  echo     if (-not $pid) { $pid = Get-LembretesPid }
  echo     if ($pid) {
  echo       Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  echo       Remove-Item $PidFile -ErrorAction SilentlyContinue
  echo       Write-Host "Servidor parado (PID $pid)."
  echo     } else {
  echo       Write-Host 'Nenhum servidor encontrado.'
  echo     }
  echo     return
  echo   }
  echo.
  echo   if ($Bg) {
  echo     $runningPid = Get-LembretesPid
  echo     if ($runningPid) {
  echo       Write-Host "Ja esta rodando em $Url (PID $runningPid)."
  echo       if ($Open) { Start-Process $Url }
  echo       return
  echo     }
  echo.
  echo     $proc = Start-Process -FilePath 'npm.cmd' -ArgumentList @('--prefix', $AppPath, 'run', 'serve') -WorkingDirectory $AppPath -WindowStyle Hidden -PassThru
  echo     Set-Content -Path $PidFile -Value $proc.Id
  echo     Start-Sleep -Seconds 1
  echo     Write-Host "Servidor iniciado em background em $Url (PID $($proc.Id))."
  echo     if ($Open) { Start-Process $Url }
  echo     return
  echo   }
  echo.
  echo   npm --prefix $AppPath start
  echo }
  echo # ^<^<^< LEMBRETES NOC ^<^<^<
  echo '@
  echo $block = $block.Replace('__APP_PATH__', $appPath)
  echo $regex = [regex]::Escape($start^) + '[\s\S]*?' + [regex]::Escape($end^)
  echo if ([regex]::IsMatch($existing, $regex^)^) {
  echo   $updated = [regex]::Replace($existing, $regex, $block^)
  echo } else {
  echo   if ($existing.Length -gt 0 -and -not $existing.EndsWith([Environment]::NewLine^)^) { $existing += [Environment]::NewLine }
  echo   $updated = $existing + [Environment]::NewLine + $block + [Environment]::NewLine
  echo }
  echo Set-Content -Path $PROFILE -Value $updated -Encoding UTF8
  echo Write-Host ('Profile atualizado: ' + $PROFILE)
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%TMP_PS%"
set "PS_EXIT=%ERRORLEVEL%"
del /q "%TMP_PS%" >nul 2>&1
if not "%PS_EXIT%"=="0" goto :fail

echo [4/4] Setup concluido.
echo.
echo Abra um novo PowerShell e use:
echo   lembretes -Bg -Open
echo.
echo Comandos disponiveis:
echo   lembretes
echo   lembretes -Bg
echo   lembretes -Bg -Open
echo   lembretes -Status
echo   lembretes -Stop
goto :ok

:fail
echo.
echo [FALHA] O setup nao foi concluido.
popd >nul 2>&1
endlocal
exit /b 1

:ok
popd >nul 2>&1
endlocal
exit /b 0
