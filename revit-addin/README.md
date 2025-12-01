# LOD 400 Uploader - Revit Add-in

A Revit add-in for uploading BIM models to the LOD 400 Delivery Platform for professional LOD 300 to LOD 400 upgrades.

## Features

- **Sheet Selection**: Browse and select specific sheets from your Revit model
- **Pricing Preview**: See real-time pricing (150 SAR per sheet) before payment
- **Secure Payment**: Integrated Stripe checkout for secure transactions
- **Model Packaging**: Automatically packages your model with sheet manifest
- **Upload Progress**: Track upload progress with real-time feedback
- **Order Tracking**: Check order status and download completed deliverables

## Requirements

- **Revit Version**: 2024 (can be adapted for 2020-2025)
- **.NET Framework**: 4.8
- **Visual Studio**: 2022 or later (for compilation)
- **Internet Connection**: Required for API communication

## Installation

### Step 1: Configure API URL

Before building, update the API URL in `App.cs`:

```csharp
// In App.cs, update this line with your actual Replit URL:
ApiBaseUrl = Environment.GetEnvironmentVariable("LOD400_API_URL") 
    ?? "https://YOUR-REPLIT-URL.replit.app";
```

### Step 2: Update Revit References

Update the Revit API references in `LOD400Uploader.csproj` to match your Revit installation:

```xml
<Reference Include="RevitAPI">
    <HintPath>C:\Program Files\Autodesk\Revit 2024\RevitAPI.dll</HintPath>
    <Private>False</Private>
</Reference>
<Reference Include="RevitAPIUI">
    <HintPath>C:\Program Files\Autodesk\Revit 2024\RevitAPIUI.dll</HintPath>
    <Private>False</Private>
</Reference>
```

For different Revit versions, update the path (e.g., `Revit 2023`, `Revit 2022`, etc.)

### Step 3: Build the Project

1. Open `LOD400Uploader.csproj` in Visual Studio 2022
2. Restore NuGet packages (Newtonsoft.Json)
3. Build the solution in Release mode
4. The output will be in `bin\Release\net48\`

### Step 4: Install the Add-in

1. Copy the following files to your Revit add-ins folder:
   - `LOD400Uploader.dll`
   - `Newtonsoft.Json.dll`
   - `LOD400Uploader.addin`

2. The add-ins folder is typically located at:
   - **Current User**: `%APPDATA%\Autodesk\Revit\Addins\2024\`
   - **All Users**: `C:\ProgramData\Autodesk\Revit\Addins\2024\`

3. Restart Revit

## Usage

### Uploading Sheets

1. Open your Revit model
2. Save the model (required before upload)
3. Go to the **LOD 400** tab in the ribbon
4. Click **Upload Sheets**
5. Select the sheets you want to upgrade
6. Review the pricing summary
7. Click **Pay & Upload**
8. Complete payment in your browser
9. Wait for the upload to complete

### Checking Order Status

1. Go to the **LOD 400** tab
2. Click **Check Status**
3. View your order history
4. Select a completed order
5. Click **Download Deliverables** to get your upgraded model

## Project Structure

```
LOD400Uploader/
├── App.cs                    # Main application entry point
├── LOD400Uploader.csproj     # Project file
├── LOD400Uploader.addin      # Revit add-in manifest
├── Commands/
│   ├── UploadSheetsCommand.cs   # Upload command
│   └── CheckStatusCommand.cs    # Status check command
├── Models/
│   └── Order.cs              # API data models
├── Services/
│   ├── ApiService.cs         # API communication
│   └── PackagingService.cs   # Model packaging
└── Views/
    ├── UploadDialog.xaml      # Upload UI
    ├── UploadDialog.xaml.cs
    ├── StatusDialog.xaml      # Status UI
    └── StatusDialog.xaml.cs
```

## Authentication

The add-in uses token-based authentication. When you first use the add-in, you may be prompted to log in through the web browser. Your authentication will be maintained across sessions.

## Troubleshooting

### Add-in Not Loading

1. Check that all files are in the correct add-ins folder
2. Verify the `.addin` manifest has the correct assembly name
3. Check Revit's add-in manager for loading errors

### Connection Errors

1. Verify your internet connection
2. Check that the API URL is correct in `App.cs`
3. Ensure the server is running

### Upload Failures

1. Save your model before uploading
2. Check file size (large models may take longer)
3. Ensure stable internet connection during upload

## Support

For technical support or questions, please contact the LOD 400 Delivery Platform team.

## License

This add-in is provided as part of the LOD 400 Delivery Platform service.
