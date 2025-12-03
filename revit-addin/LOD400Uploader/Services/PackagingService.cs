using System;
using System.IO;
using System.IO.Compression;
using System.Collections.Generic;
using Autodesk.Revit.DB;

namespace LOD400Uploader.Services
{
    public class PackagingService
    {
        private string _tempDir;
        private string _zipPath;

        public string PackageModel(Document document, List<ElementId> selectedSheetIds, Action<int, string> progressCallback)
        {
            _tempDir = null;
            _zipPath = null;

            try
            {
                progressCallback?.Invoke(5, "Validating model...");

                string originalPath = document.PathName;
                if (string.IsNullOrEmpty(originalPath) || !File.Exists(originalPath))
                {
                    throw new InvalidOperationException("Please save your Revit model before uploading.");
                }

                if (document.IsModified)
                {
                    throw new InvalidOperationException("Please save your changes before uploading. The model has unsaved modifications.");
                }

                _tempDir = Path.Combine(Path.GetTempPath(), "LOD400Upload_" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(_tempDir);

                progressCallback?.Invoke(15, "Preparing model copy...");

                string fileName = Path.GetFileName(originalPath);
                string modelCopyPath = Path.Combine(_tempDir, fileName);

                bool isWorkshared = document.IsWorkshared;
                
                if (isWorkshared)
                {
                    progressCallback?.Invoke(25, "Detaching workshared model...");
                    var detachOption = new SaveAsOptions
                    {
                        OverwriteExistingFile = true,
                        MaximumBackups = 1
                    };
                    
                    var worksharingOptions = new WorksharingSaveAsOptions();
                    worksharingOptions.SaveAsCentral = false;
                    detachOption.SetWorksharingOptions(worksharingOptions);
                    
                    var tempSavePath = Path.Combine(_tempDir, "temp_" + fileName);
                    document.SaveAs(tempSavePath, detachOption);
                    
                    if (File.Exists(tempSavePath))
                    {
                        File.Move(tempSavePath, modelCopyPath);
                    }
                }
                else
                {
                    progressCallback?.Invoke(25, "Copying model file...");
                    File.Copy(originalPath, modelCopyPath, true);
                }

                progressCallback?.Invoke(50, "Creating sheet manifest...");
                string manifestPath = Path.Combine(_tempDir, "sheets.json");
                CreateSheetManifest(document, selectedSheetIds, manifestPath);

                progressCallback?.Invoke(70, "Creating ZIP package...");
                _zipPath = Path.Combine(Path.GetTempPath(), $"LOD400_Upload_{DateTime.Now:yyyyMMdd_HHmmss}.zip");
                
                if (File.Exists(_zipPath))
                {
                    File.Delete(_zipPath);
                }

                ZipFile.CreateFromDirectory(_tempDir, _zipPath, CompressionLevel.Optimal, false);

                progressCallback?.Invoke(90, "Cleaning up temporary files...");
                CleanupTempDirectory();

                progressCallback?.Invoke(100, "Package created successfully");

                return _zipPath;
            }
            catch (Exception)
            {
                CleanupTempDirectory();
                CleanupZipFile();
                throw;
            }
        }

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
                        id = sheetId.Value,
                        number = sheet.SheetNumber ?? "",
                        name = sheet.Name ?? "",
                        revisionNumber = GetParameterValue(sheet, BuiltInParameter.SHEET_CURRENT_REVISION),
                        revisionDate = GetParameterValue(sheet, BuiltInParameter.SHEET_CURRENT_REVISION_DATE),
                        drawnBy = GetParameterValue(sheet, BuiltInParameter.SHEET_DRAWN_BY),
                        checkedBy = GetParameterValue(sheet, BuiltInParameter.SHEET_CHECKED_BY)
                    });
                }
            }

            var manifest = new
            {
                projectName = document.Title ?? "Untitled",
                projectNumber = GetProjectInfo(document, BuiltInParameter.PROJECT_NUMBER),
                clientName = GetProjectInfo(document, BuiltInParameter.CLIENT_NAME),
                exportDate = DateTime.UtcNow.ToString("o"),
                revitVersion = document.Application?.VersionNumber ?? "Unknown",
                isWorkshared = document.IsWorkshared,
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
                var p = element?.get_Parameter(param);
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
                var projectInfo = document?.ProjectInformation;
                var p = projectInfo?.get_Parameter(param);
                return p?.AsString() ?? "";
            }
            catch
            {
                return "";
            }
        }

        public long GetFileSize(string filePath)
        {
            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath))
            {
                throw new FileNotFoundException("Package file not found.", filePath);
            }
            return new FileInfo(filePath).Length;
        }

        public byte[] ReadFileBytes(string filePath)
        {
            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath))
            {
                throw new FileNotFoundException("Package file not found.", filePath);
            }
            return File.ReadAllBytes(filePath);
        }

        public void Cleanup(string filePath)
        {
            _zipPath = filePath;
            CleanupZipFile();
        }

        private void CleanupTempDirectory()
        {
            if (!string.IsNullOrEmpty(_tempDir) && Directory.Exists(_tempDir))
            {
                try
                {
                    Directory.Delete(_tempDir, true);
                }
                catch
                {
                }
                _tempDir = null;
            }
        }

        private void CleanupZipFile()
        {
            if (!string.IsNullOrEmpty(_zipPath) && File.Exists(_zipPath))
            {
                try
                {
                    File.Delete(_zipPath);
                }
                catch
                {
                }
                _zipPath = null;
            }
        }
    }
}
