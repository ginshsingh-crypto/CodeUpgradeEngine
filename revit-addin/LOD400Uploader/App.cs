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
                ApiBaseUrl = LoadApiUrl();

                string tabName = "LOD 400";
                application.CreateRibbonTab(tabName);

                RibbonPanel ribbonPanel = application.CreateRibbonPanel(tabName, "Upload");

                string assemblyPath = Assembly.GetExecutingAssembly().Location;

                PushButtonData uploadButtonData = new PushButtonData(
                    "SelectSheets",
                    "Select\nSheets",
                    assemblyPath,
                    "LOD400Uploader.Commands.UploadSheetsCommand"
                );
                uploadButtonData.ToolTip = "Select sheets and upload for LOD 400 upgrade";

                PushButton uploadButton = ribbonPanel.AddItem(uploadButtonData) as PushButton;

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
            // Check if an upload is still in progress and warn the user
            // Note: We cannot prevent Revit shutdown, but we can notify the user
            if (LOD400Uploader.Views.UploadHelper.IsUploadInProgress())
            {
                TaskDialog dialog = new TaskDialog("Upload In Progress");
                dialog.MainInstruction = "An upload is still in progress!";
                dialog.MainContent = "Your model upload will be cancelled if Revit closes.\n\n" +
                    "Please wait for the upload to complete before closing Revit.";
                dialog.MainIcon = TaskDialogIcon.TaskDialogIconWarning;
                dialog.Show();
            }
            
            return Result.Succeeded;
        }
        
        private string LoadApiUrl()
        {
            string envUrl = Environment.GetEnvironmentVariable("LOD400_API_URL");
            if (!string.IsNullOrEmpty(envUrl))
            {
                return envUrl.TrimEnd('/');
            }
            
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
                }
            }
            
            return "https://deepnewbim.com";
        }
        
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
