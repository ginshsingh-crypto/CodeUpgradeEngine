using System;
using System.IO;
using System.IO.Compression;
using System.Collections.Generic;
using Autodesk.Revit.DB;

namespace LOD400Uploader.Services
{
    /// <summary>
    /// Service for packaging Revit model files for upload
    /// </summary>
    public class PackagingService
    {
        /// <summary>
        /// Creates a ZIP package containing the Revit model and selected sheet information
        /// </summary>
        /// <param name="document">The Revit document to package</param>
        /// <param name="selectedSheetIds">IDs of selected sheets</param>
        /// <param name="progressCallback">Callback for progress updates (0-100)</param>
        /// <returns>Path to the created ZIP file</returns>
        public string PackageModel(Document document, List<ElementId> selectedSheetIds, Action<int, string> progressCallback)
        {
            string tempDir = Path.Combine(Path.GetTempPath(), "LOD400Upload_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempDir);

            try
            {
                progressCallback?.Invoke(10, "Preparing model...");

                // Get the original file path
                string originalPath = document.PathName;
                string fileName = Path.GetFileName(originalPath);

                // Save a copy of the model to temp directory
                progressCallback?.Invoke(20, "Copying model file...");
                string modelCopyPath = Path.Combine(tempDir, fileName);
                
                // Use SaveAs to create a copy if the document has been saved before
                if (!string.IsNullOrEmpty(originalPath) && File.Exists(originalPath))
                {
                    File.Copy(originalPath, modelCopyPath, true);
                }
                else
                {
                    // Document hasn't been saved - prompt user to save first
                    throw new InvalidOperationException("Please save your Revit model before uploading.");
                }

                // Create sheet manifest
                progressCallback?.Invoke(50, "Creating sheet manifest...");
                string manifestPath = Path.Combine(tempDir, "sheets.json");
                CreateSheetManifest(document, selectedSheetIds, manifestPath);

                // Create ZIP package
                progressCallback?.Invoke(70, "Creating package...");
                string zipPath = Path.Combine(Path.GetTempPath(), $"LOD400_Upload_{DateTime.Now:yyyyMMdd_HHmmss}.zip");
                
                if (File.Exists(zipPath))
                {
                    File.Delete(zipPath);
                }

                ZipFile.CreateFromDirectory(tempDir, zipPath, CompressionLevel.Optimal, false);

                progressCallback?.Invoke(100, "Package created successfully");

                return zipPath;
            }
            finally
            {
                // Clean up temp directory
                try
                {
                    if (Directory.Exists(tempDir))
                    {
                        Directory.Delete(tempDir, true);
                    }
                }
                catch
                {
                    // Ignore cleanup errors
                }
            }
        }

        /// <summary>
        /// Creates a JSON manifest of selected sheets
        /// </summary>
        private void CreateSheetManifest(Document document, List<ElementId> selectedSheetIds, string manifestPath)
        {
            var sheets = new List<object>();

            foreach (var sheetId in selectedSheetIds)
            {
                var sheet = document.GetElement(sheetId) as ViewSheet;
                if (sheet != null)
                {
                    sheets.Add(new
                    {
                        id = sheetId.IntegerValue,
                        number = sheet.SheetNumber,
                        name = sheet.Name,
                        revisionNumber = GetParameterValue(sheet, BuiltInParameter.SHEET_CURRENT_REVISION),
                        revisionDate = GetParameterValue(sheet, BuiltInParameter.SHEET_CURRENT_REVISION_DATE),
                        drawnBy = GetParameterValue(sheet, BuiltInParameter.SHEET_DRAWN_BY),
                        checkedBy = GetParameterValue(sheet, BuiltInParameter.SHEET_CHECKED_BY)
                    });
                }
            }

            var manifest = new
            {
                projectName = document.Title,
                projectNumber = GetProjectInfo(document, BuiltInParameter.PROJECT_NUMBER),
                clientName = GetProjectInfo(document, BuiltInParameter.CLIENT_NAME),
                exportDate = DateTime.UtcNow.ToString("o"),
                revitVersion = document.Application.VersionNumber,
                sheetCount = sheets.Count,
                sheets = sheets
            };

            string json = Newtonsoft.Json.JsonConvert.SerializeObject(manifest, Newtonsoft.Json.Formatting.Indented);
            File.WriteAllText(manifestPath, json);
        }

        private string GetParameterValue(Element element, BuiltInParameter param)
        {
            try
            {
                var p = element.get_Parameter(param);
                return p?.AsString() ?? "";
            }
            catch
            {
                return "";
            }
        }

        private string GetProjectInfo(Document document, BuiltInParameter param)
        {
            try
            {
                var projectInfo = document.ProjectInformation;
                var p = projectInfo?.get_Parameter(param);
                return p?.AsString() ?? "";
            }
            catch
            {
                return "";
            }
        }

        /// <summary>
        /// Gets the file size of the package
        /// </summary>
        public long GetFileSize(string filePath)
        {
            return new FileInfo(filePath).Length;
        }

        /// <summary>
        /// Reads file bytes for upload
        /// </summary>
        public byte[] ReadFileBytes(string filePath)
        {
            return File.ReadAllBytes(filePath);
        }

        /// <summary>
        /// Cleans up temporary files
        /// </summary>
        public void Cleanup(string filePath)
        {
            try
            {
                if (File.Exists(filePath))
                {
                    File.Delete(filePath);
                }
            }
            catch
            {
                // Ignore cleanup errors
            }
        }
    }
}
