# LOD 400 Uploader - Revit Add-in

A Revit add-in for uploading BIM models to the LOD 400 Delivery Platform for professional LOD 300 to LOD 400 upgrades.

## Features

- **Sheet Selection**: Browse and select specific sheets from your Revit model
- **Pricing Preview**: See real-time pricing (150 SAR per sheet) before payment
- **Secure Payment**: Integrated Stripe checkout for secure transactions
- **Model Packaging**: Automatically packages your model with sheet manifest
- **Workshared Support**: Safely handles workshared/central models
- **Upload Progress**: Track upload progress with real-time feedback
- **Order Tracking**: Check order status and download completed deliverables

## Requirements

- **Revit Version**: 2022, 2023, or 2024
- **.NET Framework**: 4.8
- **Visual Studio**: 2022 or later (for compilation)
- **Internet Connection**: Required for API communication

> **Note on Revit 2025**: Revit 2025 uses .NET 8 (not .NET Framework 4.8), so this add-in is **not compatible** with Revit 2025. A separate .NET 8 build would be required for 2025 support.

## Getting Started

### Step 1: Create Your Account

1. Go to the LOD 400 Delivery web platform
2. Click "Sign Up" to create a new account with your email and password
3. Your login credentials will be the same for both the website and this add-in

### Step 2: Configure API URL

Before building, update the API URL in `App.cs`:

```csharp
// In App.cs, update this line with your actual Replit URL:
ApiBaseUrl = Environment.GetEnvironmentVariable("LOD400_API_URL") 
    ?? "https://YOUR-REPLIT-URL.replit.app";
```

### Step 3: Update Revit References

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

### Step 4: Build the Project

1. Open `LOD400Uploader.csproj` in Visual Studio 2022
2. Restore NuGet packages (Newtonsoft.Json will be merged into the main DLL automatically)
3. Build the solution in Release mode
4. The output will be in `bin\Release\net48\`

### Step 5: Install the Add-in

1. Copy the following files to your Revit add-ins folder:
   - `LOD400Uploader.dll` (includes Newtonsoft.Json merged via ILRepack)
   - `LOD400Uploader.addin`

2. The add-ins folder is typically located at:
   - **Current User**: `%APPDATA%\Autodesk\Revit\Addins\2024\`
   - **All Users**: `C:\ProgramData\Autodesk\Revit\Addins\2024\`

3. Restart Revit

## Usage

### First-Time Login

1. Go to the **LOD 400** tab in the ribbon
2. Click **Upload Sheets** or **Check Status**
3. Enter your email and password when prompted
4. Your credentials will be saved for future sessions

### Uploading Sheets

1. Open your Revit model
2. Save the model (required before upload)
3. Go to the **LOD 400** tab in the ribbon
4. Click **Upload Sheets**
5. Select the sheets you want to upgrade
6. Review the pricing summary
7. Click **Pay & Upload**
8. Complete payment in your browser
9. Wait for payment confirmation (automatic polling)
10. Upload begins automatically after payment

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
│   ├── ApiService.cs         # API communication (with email/password auth)
│   └── PackagingService.cs   # Model packaging (workshared safe)
└── Views/
    ├── LoginDialog.xaml       # Email/password login UI
    ├── LoginDialog.xaml.cs
    ├── UploadDialog.xaml      # Upload UI
    ├── UploadDialog.xaml.cs
    ├── StatusDialog.xaml      # Status UI
    └── StatusDialog.xaml.cs
```

## Authentication

The add-in uses email/password authentication (same as the website):
- Use your LOD 400 platform account credentials to sign in
- Session tokens are stored securely in `%APPDATA%\LOD400Uploader\config.json`
- Sessions expire after 30 days of inactivity

## Workshared Models

The add-in safely handles workshared (central) models:
- Detaches a copy for upload without affecting the central model
- Preserves all model data and links
- No changes are made to the original central model

## Troubleshooting

### Add-in Not Loading

1. Check that all files are in the correct add-ins folder
2. Verify the `.addin` manifest has the correct assembly name
3. Check Revit's add-in manager for loading errors

### Login Failed

1. Verify your email and password are correct
2. Try logging in to the web platform to confirm your account works
3. Delete `%APPDATA%\LOD400Uploader\config.json` and try again

### Connection Errors

1. Verify your internet connection
2. Check that the API URL is correct in `App.cs`
3. Ensure the server is running

### Upload Failures

1. Save your model before uploading
2. Ensure unsaved changes are saved
3. For workshared models, ensure you have proper access
4. Check file size (large models may take longer)
5. Ensure stable internet connection during upload

### Payment Timeout

1. Complete payment in the browser promptly
2. If timeout occurs, you can continue waiting
3. Check order status later if needed

## API Endpoints Used

The add-in communicates with these API endpoints:

- `GET /api/addin/validate` - Validate API key
- `POST /api/addin/create-order` - Create order and get payment URL
- `GET /api/addin/orders` - List user orders
- `GET /api/addin/orders/:id/status` - Get order status
- `POST /api/addin/orders/:id/upload-url` - Get file upload URL
- `POST /api/addin/orders/:id/upload-complete` - Mark upload complete
- `GET /api/addin/orders/:id/download-url` - Get deliverable download URL

## Support

For technical support or questions, please contact the LOD 400 Delivery Platform team.

## License

This add-in is provided as part of the LOD 400 Delivery Platform service.
