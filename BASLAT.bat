@echo off
title THE LAST SERVER
cd /d "%~dp0"
echo.
echo  ===== THE LAST SERVER =====
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun,
  echo sonra bu dosyaya tekrar cift tiklayin.
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0])>=20?0:1)"
if errorlevel 1 (
  echo Node.js surumunuz eski. https://nodejs.org adresinden LTS surumunu kurun ^(20 veya ustu^).
  pause
  exit /b 1
)

if not exist node_modules (
  echo Ilk kurulum yapiliyor, 1-2 dakika surebilir...
  call npm install
  if errorlevel 1 (
    echo Kurulum basarisiz oldu. Yukaridaki hata mesajini kopyalayin.
    pause
    exit /b 1
  )
)

echo.
echo Oyun birkac saniye icinde tarayicida acilacak: http://localhost:8080
echo BU PENCEREYI KAPATMAYIN. Durdurmak icin Ctrl+C.
echo.
start "" cmd /c "timeout /t 5 >nul & start http://localhost:8080"
call npm start
echo.
echo Sunucu durdu.
pause
