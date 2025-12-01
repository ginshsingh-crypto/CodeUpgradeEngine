using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using LOD400Uploader.Views;
using System;

namespace LOD400Uploader.Commands
{
    /// <summary>
    /// Command to check order status and download deliverables
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    public class CheckStatusCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            try
            {
                // Open the status dialog
                var dialog = new StatusDialog();
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
