@echo off
REM Build script for multi-version Revit add-in (2022, 2023, 2024)
REM All these versions use .NET Framework 4.8

echo ========================================
echo LOD 400 Uploader - Multi-Version Build
echo ========================================

set OUTPUT_BASE=bin\Release
set PROJECT=LOD400Uploader\LOD400Uploader.csproj

REM Clean previous builds
if exist "%OUTPUT_BASE%" rmdir /s /q "%OUTPUT_BASE%"

REM Build for Revit 2022
echo.
echo Building for Revit 2022...
dotnet build %PROJECT% -c Release /p:RevitVersion=2022 -o %OUTPUT_BASE%\2022
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build for Revit 2022 failed
    exit /b 1
)

REM Build for Revit 2023
echo.
echo Building for Revit 2023...
dotnet build %PROJECT% -c Release /p:RevitVersion=2023 -o %OUTPUT_BASE%\2023
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build for Revit 2023 failed
    exit /b 1
)

REM Build for Revit 2024
echo.
echo Building for Revit 2024...
dotnet build %PROJECT% -c Release /p:RevitVersion=2024 -o %OUTPUT_BASE%\2024
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build for Revit 2024 failed
    exit /b 1
)

REM Copy .addin files for each version
echo.
echo Copying manifest files...
copy LOD400Uploader\LOD400Uploader.addin %OUTPUT_BASE%\2022\
copy LOD400Uploader\LOD400Uploader.addin %OUTPUT_BASE%\2023\
copy LOD400Uploader\LOD400Uploader.addin %OUTPUT_BASE%\2024\

echo.
echo ========================================
echo Build complete!
echo ========================================
echo Output folders:
echo   %OUTPUT_BASE%\2022 - For Revit 2022
echo   %OUTPUT_BASE%\2023 - For Revit 2023
echo   %OUTPUT_BASE%\2024 - For Revit 2024
echo.
echo To install, copy contents of the appropriate folder to:
echo   %%APPDATA%%\Autodesk\Revit\Addins\[version]\
echo ========================================
