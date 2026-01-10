@echo off
REM Setup script for Toponymy development on Windows

echo.
echo 🚀 Setting up Toponymy...
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js is not installed. Please install Node.js 16+ first.
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✓ Node.js version: %NODE_VERSION%

REM Install root dependencies
echo.
echo 📦 Installing root dependencies...
call npm install

REM Install web dependencies
echo.
echo 📦 Installing web dependencies...
cd web
call npm install
cd ..

REM Install API dependencies
echo.
echo 📦 Installing API dependencies...
cd api
call npm install
cd ..

REM Create data directory for local development
echo.
echo 📁 Creating local data directory...
if not exist server\data mkdir server\data

echo.
echo ✅ Setup complete!
echo.
echo 🏃 To start development:
echo    npm run dev
echo.
echo 🔨 To build for production:
echo    npm run build
echo.
echo 📖 For deployment instructions, see README.md
echo.
pause
