using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using System;
using System.IO;
using System.Reflection;
using System.Windows.Media.Imaging;
using Newtonsoft.Json.Linq;

namespace LOD400Uploader
{
    /// <summary>
    /// Revit External Application - Entry point for the add-in
    /// </summary>
    public class App : IExternalApplication
    {
        public static string ApiBaseUrl { get; private set; }
        public static string AuthToken { get; set; }
        
        private static readonly string ConfigDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "LOD400Uploader"
        );
        private static readonly string ConfigFile = Path.Combine(ConfigDir, "config.json");

        public Result OnStartup(UIControlledApplication application)
        {
            try
            {
                // Load API URL from config file, environment, or default
                ApiBaseUrl = LoadApiUrl();

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
        
        /// <summary>
        /// Load API URL from config file, environment variable, or use default
        /// </summary>
        private string LoadApiUrl()
        {
            // First check environment variable
            string envUrl = Environment.GetEnvironmentVariable("LOD400_API_URL");
            if (!string.IsNullOrEmpty(envUrl))
            {
                return envUrl.TrimEnd('/');
            }
            
            // Then check config file (created by installer)
            if (File.Exists(ConfigFile))
            {
                try
                {
                    string json = File.ReadAllText(ConfigFile);
                    JObject config = JObject.Parse(json);
                    string configUrl = config["apiUrl"]?.ToString();
                    if (!string.IsNullOrEmpty(configUrl))
                    {
                        return configUrl.TrimEnd('/');
                    }
                }
                catch
                {
                    // Ignore config read errors, use default
                }
            }
            
            // Default URL - update this after deployment
            return "https://lod400-platform.replit.app";
        }
        
        /// <summary>
        /// Save API URL to config file
        /// </summary>
        public static void SaveApiUrl(string url)
        {
            try
            {
                if (!Directory.Exists(ConfigDir))
                {
                    Directory.CreateDirectory(ConfigDir);
                }
                
                JObject config = new JObject
                {
                    ["apiUrl"] = url.TrimEnd('/'),
                    ["updatedAt"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")
                };
                
                File.WriteAllText(ConfigFile, config.ToString());
                ApiBaseUrl = url.TrimEnd('/');
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to save config: {ex.Message}");
            }
        }
    }
}
