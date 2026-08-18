@echo off
cd /d "%~dp0"
if not exist ".env" if exist ".env.example" copy ".env.example" ".env" >nul
if not exist "node_modules" (
  echo First run: installing LyricPad frontend dependencies...
  call npm install
  if errorlevel 1 goto :error
) else (
  echo Building LyricPad frontend...
  call npm run build
  if errorlevel 1 goto :error
)
start "" http://localhost:8787
node server.mjs
goto :eof
:error
echo.
echo LyricPad could not install/build. Check the error above.
pause
