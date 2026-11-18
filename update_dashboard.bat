@echo off
chcp 65001 >nul
title Update Dashboard TBR Region XI
cd /d "%~dp0"
echo ============================================================
echo   UPDATE DASHBOARD TRANSACTION BANKING RETAIL REGION XI
echo ============================================================
echo.
echo [1/2] Mengolah file Excel di folder induk...
python scripts\build_data.py --source ".."
if errorlevel 1 (
  echo.
  echo GAGAL membangun data. Periksa pesan di atas.
  pause
  exit /b 1
)
echo.
echo [2/2] Mengirim data terbaru ke GitHub...
git add -A
git commit -m "Update data dashboard %date% %time%"
git push
if errorlevel 1 (
  echo.
  echo Push ke GitHub gagal. Pastikan sudah login git dan terhubung internet.
  pause
  exit /b 1
)
echo.
echo SELESAI. Dashboard online akan berubah dalam 1-2 menit.
if "%1"=="" pause
