@echo off
title SoodYar - Reset Data
cd /d "%~dp0"

echo ============================================
echo    SoodYar - Full data reset
echo ============================================
echo.
echo WARNING: all members, transactions, assets and history will be deleted.
echo Settings will be restored to defaults.
echo.
set /p confirm="Type Y then Enter to continue: "
if /i not "%confirm%"=="Y" (
  echo Cancelled.
  pause
  goto :eof
)

call npm run db:reset
echo.
echo Done. You can now run start.bat
pause
