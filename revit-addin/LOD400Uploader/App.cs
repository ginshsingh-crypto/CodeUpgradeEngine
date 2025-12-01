using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using System;
using System.Reflection;
using System.Windows.Media.Imaging;

namespace LOD400Uploader
{
    /// <summary>
    /// Revit External Application - Entry point for the add-in
    /// </summary>
    public class App : IExternalApplication
    {
        public static string ApiBaseUrl { get; private set; }
        public static string AuthToken { get; set; }

        public Result OnStartup(UIControlledApplication application)
        {
            try
            {
                // Set API base URL from environment or default
                ApiBaseUrl = Environment.GetEnvironmentVariable("LOD400_API_URL") 
                    ?? "https://YOUR-REPLIT-URL.replit.app";

                // Create ribbon tab
                string tabName = "LOD 400";
                application.CreateRibbonTab(tabName);

                // Create ribbon panel
                RibbonPanel ribbonPanel = application.CreateRibbonPanel(tabName, "Sheet Upgrade");

                // Get assembly path for button
                string assemblyPath = Assembly.GetExecutingAssembly().Location;

                // Create push button for upload command
                PushButtonData uploadButtonData = new PushButtonData(
                    "UploadSheets",
                    "Upload\nSheets",
                    assemblyPath,
                    "LOD400Uploader.Commands.UploadSheetsCommand"
                );
                uploadButtonData.ToolTip = "Select sheets and upload for LOD 400 upgrade";
                uploadButtonData.LongDescription = "Opens the LOD 400 Upload dialog where you can select sheets from your model, " +
                    "review pricing (150 SAR per sheet), pay securely via Stripe, and upload your model for professional LOD 400 upgrade.";

                PushButton uploadButton = ribbonPanel.AddItem(uploadButtonData) as PushButton;

                // Create push button for check status
                PushButtonData statusButtonData = new PushButtonData(
                    "CheckStatus",
                    "Check\nStatus",
                    assemblyPath,
                    "LOD400Uploader.Commands.CheckStatusCommand"
                );
                statusButtonData.ToolTip = "Check order status and download deliverables";
                statusButtonData.LongDescription = "View your existing orders, check processing status, and download completed LOD 400 deliverables.";

                PushButton statusButton = ribbonPanel.AddItem(statusButtonData) as PushButton;

                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                TaskDialog.Show("Error", $"Failed to initialize LOD 400 Add-in: {ex.Message}");
                return Result.Failed;
            }
        }

        public Result OnShutdown(UIControlledApplication application)
        {
            return Result.Succeeded;
        }
    }
}
