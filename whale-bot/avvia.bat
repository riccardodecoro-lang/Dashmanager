@echo off
chcp 65001 >nul
title Whale Bot
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non e' installato.
  echo Si apre la pagina di download: scarica la versione LTS, installala e poi riapri avvia.bat
  start "" https://nodejs.org/it/download
  pause
  exit /b
)

if not exist node_modules (
  echo Primo avvio: installo i pacchetti, ci vuole un minuto...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo Installazione fallita. & pause & exit /b )
)

if not exist .env (
  copy .env.example .env >nul
  echo.
  echo Ho creato il file di configurazione. Si apre Blocco note:
  echo   - in WHALES= incolla gli indirizzi dei wallet da seguire, separati da virgola
  echo   - in RPC_URL= incolla la tua RPC di Helius
  echo Poi salva [Ctrl+S], chiudi Blocco note e il bot parte.
  echo.
  notepad .env
)

start "" cmd /c "timeout /t 5 >nul & start http://127.0.0.1:8787"
node src/index.js
echo.
echo Il bot si e' fermato.
pause
