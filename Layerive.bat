@echo off
REM ============================================
REM  Layerive one-click launcher
REM  Double-click to start the app and open the
REM  workspace in your default browser.
REM ============================================
title Layerive - Local AI Image Workspace
cd /d "D:\demo\AI\image_workflow\app"

REM Auto-build the frontend once if dist is missing
if not exist "dist\index.html" (
    echo [Layerive] dist not found, building frontend first...
    call npm run build
    if errorlevel 1 (
        echo.
        echo [Layerive] Build failed. Press any key to exit.
        pause >nul
        exit /b 1
    )
)

echo [Layerive] Starting local server, please wait...
echo [Layerive] The page will open automatically. Keep this window open while using the app.
echo [Layerive] Press Ctrl+C in this window to stop the server.
echo.

REM Open the browser shortly after the server starts
start "" cmd /c "ping 127.0.0.1 -n 4 >nul & start http://127.0.0.1:8788"

call npm start

echo.
echo [Layerive] Server stopped. Press any key to close this window.
pause >nul
