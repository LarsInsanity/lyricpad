@echo off
cd /d "%~dp0"
if not exist ".env" copy ".env.example" ".env" >nul
start "" http://localhost:8787
node server.mjs
pause
