@echo off
title SoodYar
cd /d "%~dp0"

echo ============================================
echo    SoodYar - starting...
echo ============================================
echo.

if not exist "node_modules" (
  echo [1/3] Installing dependencies for the first time. This may take a few minutes...
  call npm install
  if errorlevel 1 goto :error
)

if not exist "server\.env" (
  echo [config] Creating configuration file...
  copy ".env.example" "server\.env" >nul
)

if not exist "server\prisma\prisma\dev.db" (
  echo [2/3] Creating database...
  call npm run db:setup
  if errorlevel 1 goto :error
)

echo [3/3] Launching app...
echo.
echo    Open in browser:  http://localhost:5300
echo    Keep this window open. To stop, close it or press Ctrl+C.
echo.

start "" cmd /c "timeout /t 6 >nul & start http://localhost:5300"

call npm run dev
goto :eof

:error
echo.
echo Startup failed. Please make sure Node.js version 20 or higher is installed.
pause
