using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using LOD400Uploader.Views;
using System;

namespace LOD400Uploader.Commands
{
    /// <summary>
    /// Command to open the sheet selection and upload dialog
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    public class UploadSheetsCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                UIApplication uiApp = commandData.Application;
                UIDocument uiDoc = uiApp.ActiveUIDocument;
                Document doc = uiDoc.Document;

                // Check if document is saved
                if (string.IsNullOrEmpty(doc.PathName))
                {
                    TaskDialog.Show("Save Required", 
                        "Please save your Revit model before uploading.\n\n" +
                        "Go to File > Save As to save your model first.");
                    return Result.Cancelled;
                }

                // Open the main upload dialog
                var dialog = new UploadDialog(doc);
                dialog.ShowDialog();

                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show("Error", $"An error occurred: {ex.Message}");
                return Result.Failed;
            }
        }
    }
}
