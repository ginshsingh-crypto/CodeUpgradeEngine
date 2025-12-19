@echo off
REM Installer script for LOD 400 Uploader add-in
REM Detects installed Revit versions and deploys the appropriate add-in

echo ========================================
echo LOD 400 Uploader - Installer
echo ========================================

set ADDINS_BASE=%APPDATA%\Autodesk\Revit\Addins
set SOURCE_BASE=%~dp0bin\Release

set INSTALLED=0

REM Check and install for Revit 2022
if exist "%ADDINS_BASE%\2022" (
    if exist "%SOURCE_BASE%\2022\LOD400Uploader.dll" (
        echo Installing for Revit 2022...
        xcopy /y /q "%SOURCE_BASE%\2022\*.*" "%ADDINS_BASE%\2022\"
        set /a INSTALLED+=1
        echo   Done.
    ) else (
        echo Revit 2022 detected but build not found. Run build-all-versions.bat first.
    )
)

REM Check and install for Revit 2023
if exist "%ADDINS_BASE%\2023" (
    if exist "%SOURCE_BASE%\2023\LOD400Uploader.dll" (
        echo Installing for Revit 2023...
        xcopy /y /q "%SOURCE_BASE%\2023\*.*" "%ADDINS_BASE%\2023\"
        set /a INSTALLED+=1
        echo   Done.
    ) else (
        echo Revit 2023 detected but build not found. Run build-all-versions.bat first.
    )
)

REM Check and install for Revit 2024
if exist "%ADDINS_BASE%\2024" (
    if exist "%SOURCE_BASE%\2024\LOD400Uploader.dll" (
        echo Installing for Revit 2024...
        xcopy /y /q "%SOURCE_BASE%\2024\*.*" "%ADDINS_BASE%\2024\"
        set /a INSTALLED+=1
        echo   Done.
    ) else (
        echo Revit 2024 detected but build not found. Run build-all-versions.bat first.
    )
)

echo.
if %INSTALLED% GTR 0 (
    echo ========================================
    echo Installation complete!
    echo Installed to %INSTALLED% Revit version(s).
    echo Restart Revit to load the add-in.
    echo ========================================
) else (
    echo No compatible Revit versions found or builds not available.
    echo Make sure you have Revit 2022, 2023, or 2024 installed.
    echo Run build-all-versions.bat to create the builds.
)

pause
