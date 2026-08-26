@echo off
chcp 65001 >nul
title SoodYar - سودیار
cd /d "%~dp0"

echo ============================================
echo    سودیار (SoodYar) - در حال راه‌اندازی...
echo ============================================
echo.

REM اگر وابستگی‌ها نصب نشده‌اند، نصب کن
if not exist "node_modules" (
  echo [1/3] نصب وابستگی‌ها برای اولین بار... این ممکن است چند دقیقه طول بکشد.
  call npm install
  if errorlevel 1 goto :error
)

REM اگر فایل تنظیمات محیط وجود ندارد، از نمونه بساز
if not exist "server\.env" (
  echo [تنظیمات] ساخت فایل پیکربندی...
  copy ".env.example" "server\.env" >nul
)

REM اگر پایگاه‌داده وجود ندارد، بساز
if not exist "server\prisma\prisma\dev.db" (
  echo [2/3] ساخت پایگاه‌داده...
  call npm run db:setup
  if errorlevel 1 goto :error
)

echo [3/3] اجرای برنامه...
echo.
echo    رابط کاربری:  http://localhost:5300
echo    این پنجره را باز نگه دارید. برای توقف، آن را ببندید یا Ctrl+C بزنید.
echo.

REM مرورگر را چند ثانیه بعد باز کن (تا سرور بالا بیاید)
start "" cmd /c "timeout /t 6 >nul & start http://localhost:5300"

REM اجرای همزمان سرور و رابط کاربری
call npm run dev
goto :eof

:error
echo.
echo خطا در راه‌اندازی. لطفاً مطمئن شوید Node.js نسخهٔ ۲۰ یا بالاتر نصب است.
pause
