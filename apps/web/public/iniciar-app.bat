@echo off
setlocal EnableExtensions
title Sertania - inicializacao

rem Execute este arquivo na raiz do projeto Sertania.
set "APP_ROOT=%~dp0"
if exist "%APP_ROOT%package.json" goto raiz_encontrada
if exist "%APP_ROOT%..\..\..\package.json" set "APP_ROOT=%APP_ROOT%..\..\..\"
if exist "%APP_ROOT%package.json" goto raiz_encontrada

for %%D in (
  "%USERPROFILE%\OneDrive\Documentos\Projeto Padrão"
  "%USERPROFILE%\OneDrive\Documents\Projeto Padrão"
  "%USERPROFILE%\Documentos\Projeto Padrão"
  "%USERPROFILE%\Documents\Projeto Padrão"
) do if exist "%%~D\package.json" set "APP_ROOT=%%~D"
if exist "%APP_ROOT%package.json" goto raiz_encontrada

echo A pasta do projeto nao foi encontrada automaticamente.
set /p "APP_ROOT=Digite o caminho da pasta Projeto Padrao: "
set "APP_ROOT=%APP_ROOT:"=%"
if not exist "%APP_ROOT%\package.json" goto erro_raiz

:raiz_encontrada
cd /d "%APP_ROOT%"
set "APP_URL=http://localhost:5173/"

where pnpm >nul 2>&1
if errorlevel 1 goto erro_pnpm

where docker >nul 2>&1
if errorlevel 1 goto erro_docker

if not exist ".env" (
  if not exist ".env.example" goto erro_env
  copy /Y ".env.example" ".env" >nul
  echo Arquivo .env criado a partir do .env.example.
)

echo [1/3] Subindo as dependencias Docker...
call pnpm db:up
if errorlevel 1 goto erro_db

echo [2/3] Aguardando o banco e aplicando migrations...
set "MIGRACAO_OK="
for /L %%I in (1,1,30) do (
  echo Tentativa %%I de 30...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$envPath=Join-Path (Get-Location) '.env'; foreach ($line in Get-Content $envPath) { if ($line -match '^\s*([^#=][^=]*)=(.*)$') { $name=$matches[1].Trim(); $value=$matches[2].Trim(); [Environment]::SetEnvironmentVariable($name,$value,'Process') } }; pnpm db:migrate; exit $LASTEXITCODE"
  if not errorlevel 1 (
    set "MIGRACAO_OK=1"
    goto banco_pronto
  )
  powershell -NoProfile -Command "Start-Sleep -Seconds 2"
)

if not defined MIGRACAO_OK goto erro_migracao

:banco_pronto
echo Verificando se a aplicacao ja esta em execucao...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$web=$false; $api=$false; try { $r=Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%' -TimeoutSec 1; $web=$r.StatusCode -ge 200 -and $r.StatusCode -lt 500 } catch {}; try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/v1/health' -TimeoutSec 1; $api=$r.StatusCode -eq 200 } catch {}; if ($web -and $api) { exit 0 }; exit 1"
if not errorlevel 1 goto abrir_app

echo [3/3] Iniciando API e frontend...
start "Sertania - API e Web" /D "%APP_ROOT%" cmd /k "pnpm dev"

echo Aguardando API e frontend ficarem disponiveis (ate 2 minutos)...
set "SERVICOS_OK="
for /L %%I in (1,1,120) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$web=$false; $api=$false; try { $r=Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%' -TimeoutSec 1; $web=$r.StatusCode -ge 200 -and $r.StatusCode -lt 500 } catch {}; try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/v1/health' -TimeoutSec 1; $api=$r.StatusCode -eq 200 } catch {}; if ($web -and $api) { exit 0 }; exit 1"
if not errorlevel 1 goto abrir_app
  powershell -NoProfile -Command "Start-Sleep -Seconds 1"
)

if not defined SERVICOS_OK goto erro_servicos

:abrir_app
start "" "%APP_URL%"
echo.
echo Aplicacao aberta em %APP_URL%
echo Feche a janela "Sertania - API e Web" para parar a aplicacao.
exit /b 0

:erro_pnpm
echo ERRO: pnpm nao foi encontrado. Instale o Node.js e o pnpm.
pause
exit /b 1

:erro_docker
echo ERRO: Docker nao foi encontrado. Abra ou instale o Docker Desktop.
pause
exit /b 1

:erro_env
echo ERRO: .env.example nao foi encontrado na raiz do projeto.
pause
exit /b 1

:erro_db
echo ERRO: nao foi possivel subir as dependencias Docker.
pause
exit /b 1

:erro_migracao
echo ERRO: o banco nao ficou pronto ou as migrations falharam.
echo Execute "pnpm db:logs" para consultar os logs.
pause
exit /b 1

:erro_raiz
echo ERRO: a pasta informada nao contem o package.json do projeto.
pause
exit /b 1

:erro_servicos
echo ERRO: a API ou o frontend nao ficaram disponiveis em 2 minutos.
echo Verifique a janela "Sertania - API e Web" para consultar o erro.
pause
exit /b 1
