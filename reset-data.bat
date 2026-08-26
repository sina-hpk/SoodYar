@echo off
chcp 65001 >nul
title SoodYar - پاک‌سازی داده‌ها
cd /d "%~dp0"

echo ============================================
echo    پاک‌سازی کامل داده‌های سودیار
echo ============================================
echo.
echo هشدار: تمام اعضا، تراکنش‌ها، دارایی‌ها و تاریخچه پاک می‌شوند.
echo تنظیمات به حالت پیش‌فرض برمی‌گردند.
echo.
set /p confirm="برای ادامه Y و سپس Enter بزنید: "
if /i not "%confirm%"=="Y" (
  echo لغو شد.
  pause
  goto :eof
)

call npm run db:reset
echo.
echo انجام شد. حالا می‌توانید start.bat را اجرا کنید.
pause
