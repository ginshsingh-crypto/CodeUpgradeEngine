# LOD 400 Uploader - Revit Add-in Installer
# Run this script with: Right-click -> Run with PowerShell
# Or: powershell -ExecutionPolicy Bypass -File Install-LOD400.ps1

param(
    [string]$ApiUrl = ""
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LOD 400 Uploader - Revit Add-in" -ForegroundColor Cyan
Write-Host "  Installation Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptDir) {
    $ScriptDir = Get-Location
}

# Required files
# Note: Newtonsoft.Json.dll is now merged into LOD400Uploader.dll via ILRepack
# to avoid DLL conflicts with Revit's bundled version
$RequiredFiles = @(
    "LOD400Uploader.dll",
    "LOD400Uploader.addin"
)

# Check if required files exist
Write-Host "Checking required files..." -ForegroundColor Yellow
$MissingFiles = @()
foreach ($file in $RequiredFiles) {
    $filePath = Join-Path $ScriptDir $file
    if (-not (Test-Path $filePath)) {
        $MissingFiles += $file
    }
}

if ($MissingFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "SETUP REQUIRED - Compilation Needed" -ForegroundColor Yellow
    Write-Host "====================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Missing files:" -ForegroundColor Red
    foreach ($file in $MissingFiles) {
        Write-Host "  - $file" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "The add-in needs to be compiled before installation." -ForegroundColor White
    Write-Host "This is a one-time setup that requires Visual Studio 2022." -ForegroundColor White
    Write-Host ""
    Write-Host "Steps to compile:" -ForegroundColor Cyan
    Write-Host "  1. Open LOD400Uploader/LOD400Uploader.csproj in Visual Studio 2022"
    Write-Host "  2. Update Revit API references to match your Revit version"
    Write-Host "  3. Build in Release mode (Build -> Build Solution)"
    Write-Host "  4. Copy the DLL files from bin/Release/net48/ to this folder"
    Write-Host "  5. Run this installer again"
    Write-Host ""
    Write-Host "For detailed instructions, see: README.md" -ForegroundColor Gray
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "All required files found." -ForegroundColor Green
Write-Host ""

# Detect Revit installations
Write-Host "Detecting Revit installations..." -ForegroundColor Yellow

$RevitVersions = @()
$RevitBasePaths = @(
    "$env:APPDATA\Autodesk\Revit\Addins",
    "$env:ProgramData\Autodesk\Revit\Addins"
)

# Check for Revit 2020-2024 (Note: 2025 uses .NET 8 and requires separate build)
for ($year = 2020; $year -le 2024; $year++) {
    $programPath = "C:\Program Files\Autodesk\Revit $year"
    if (Test-Path $programPath) {
        $RevitVersions += $year
    }
}

if ($RevitVersions.Count -eq 0) {
    Write-Host ""
    Write-Host "WARNING: No Revit installations detected automatically." -ForegroundColor Yellow
    Write-Host "This might be because Revit is installed in a non-standard location." -ForegroundColor Yellow
    Write-Host ""
    $ManualYear = Read-Host "Enter your Revit version year (e.g., 2024), or press Enter to cancel"
    if ($ManualYear -match '^\d{4}$') {
        $RevitVersions += [int]$ManualYear
    } else {
        Write-Host "Installation cancelled." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

Write-Host ""
Write-Host "Found Revit versions: $($RevitVersions -join ', ')" -ForegroundColor Green
Write-Host ""

# Let user choose version if multiple found
$SelectedVersion = $RevitVersions[0]
if ($RevitVersions.Count -gt 1) {
    Write-Host "Multiple Revit versions found. Select which one to install to:" -ForegroundColor Yellow
    for ($i = 0; $i -lt $RevitVersions.Count; $i++) {
        Write-Host "  [$($i + 1)] Revit $($RevitVersions[$i])"
    }
    Write-Host "  [A] All versions"
    Write-Host ""
    $choice = Read-Host "Enter your choice"
    
    if ($choice -eq 'A' -or $choice -eq 'a') {
        $SelectedVersion = $RevitVersions
    } elseif ($choice -match '^\d+$' -and [int]$choice -ge 1 -and [int]$choice -le $RevitVersions.Count) {
        $SelectedVersion = @($RevitVersions[[int]$choice - 1])
    } else {
        Write-Host "Invalid choice. Using first version: Revit $($RevitVersions[0])" -ForegroundColor Yellow
        $SelectedVersion = @($RevitVersions[0])
    }
} else {
    $SelectedVersion = @($SelectedVersion)
}

# Create config directory and file
$ConfigDir = "$env:APPDATA\LOD400Uploader"
if (-not (Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
}

# Write config file with API URL
if (-not $ApiUrl) {
    Write-Host ""
    Write-Host "Enter the LOD 400 Platform URL" -ForegroundColor Yellow
    Write-Host "(This is the website address where you log in)" -ForegroundColor Gray
    $ApiUrl = Read-Host "URL (e.g., https://yourapp.replit.app)"
}

if ($ApiUrl) {
    # Remove trailing slash
    $ApiUrl = $ApiUrl.TrimEnd('/')
    
    $ConfigFile = Join-Path $ConfigDir "config.json"
    $Config = @{
        apiUrl = $ApiUrl
        installedAt = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    } | ConvertTo-Json
    
    Set-Content -Path $ConfigFile -Value $Config -Force
    Write-Host ""
    Write-Host "Configuration saved: $ConfigFile" -ForegroundColor Green
}

# Install to each selected version
Write-Host ""
Write-Host "Installing add-in..." -ForegroundColor Yellow

foreach ($version in $SelectedVersion) {
    $AddinsPath = "$env:APPDATA\Autodesk\Revit\Addins\$version"
    
    # Create addins folder if it doesn't exist
    if (-not (Test-Path $AddinsPath)) {
        Write-Host "Creating folder: $AddinsPath" -ForegroundColor Gray
        New-Item -ItemType Directory -Path $AddinsPath -Force | Out-Null
    }
    
    # Copy files
    foreach ($file in $RequiredFiles) {
        $sourcePath = Join-Path $ScriptDir $file
        $destPath = Join-Path $AddinsPath $file
        
        Write-Host "  Copying $file to Revit $version..." -ForegroundColor Gray
        Copy-Item -Path $sourcePath -Destination $destPath -Force
    }
    
    Write-Host "  Installed to Revit $version" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Start (or restart) Revit"
Write-Host "  2. Look for the 'LOD 400' tab in the ribbon"
Write-Host "  3. Click 'Upload Sheets' to get started"
Write-Host "  4. Log in with your email and password"
Write-Host ""
Write-Host "First time using the add-in?" -ForegroundColor Yellow
Write-Host "  1. Sign in at $ApiUrl" -ForegroundColor Gray
Write-Host "  2. Go to Settings and set your add-in password" -ForegroundColor Gray
Write-Host "  3. Log in to the add-in with your email and password" -ForegroundColor Gray
Write-Host ""
Read-Host "Press Enter to exit"
