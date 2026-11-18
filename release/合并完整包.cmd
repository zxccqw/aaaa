@echo off
setlocal
cd /d "%~dp0"
if exist "aaa_full.zip" del "aaa_full.zip"
copy /b aaa_full.zip.part* aaa_full.zip >nul
if errorlevel 1 goto :err
echo.
echo 合并完成：%~dp0aaa_full.zip
echo 请用 SHA256SUMS.txt 校验。
pause
exit /b 0
:err
echo 合并失败，请确认所有分卷都在同一目录。
pause
exit /b 1
