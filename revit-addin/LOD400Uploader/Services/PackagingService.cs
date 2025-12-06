using System;
using System.IO;
using System.IO.Compression;
using System.Collections.Generic;
using System.Linq;
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
                
                progressCallback?.Invoke(20, isWorkshared ? "Copying workshared model..." : "Copying model file...");
                File.Copy(originalPath, modelCopyPath, true);

                // Collect and copy linked files
                progressCallback?.Invoke(30, "Collecting linked files...");
                var linkInfo = CollectAndCopyLinks(document, progressCallback);

                progressCallback?.Invoke(60, "Creating manifest...");
                string manifestPath = Path.Combine(_tempDir, "manifest.json");
                CreateManifest(document, selectedSheetIds, linkInfo, manifestPath);

                progressCallback?.Invoke(75, "Creating ZIP package...");
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

        private LinkCollectionResult CollectAndCopyLinks(Document document, Action<int, string> progressCallback)
        {
            var result = new LinkCollectionResult();
            string linksDir = Path.Combine(_tempDir, "Links");

            try
            {
                // Get all RevitLinkType elements (linked RVT files)
                var linkTypes = new FilteredElementCollector(document)
                    .OfClass(typeof(RevitLinkType))
                    .Cast<RevitLinkType>()
                    .ToList();

                if (linkTypes.Count == 0)
                {
                    return result;
                }

                Directory.CreateDirectory(linksDir);
                int processedLinks = 0;

                foreach (var linkType in linkTypes)
                {
                    processedLinks++;
                    var linkInfo = new LinkedFileInfo
                    {
                        Name = linkType.Name,
                        Type = "RevitLink"
                    };

                    try
                    {
                        var externalRef = linkType.GetExternalFileReference();
                        if (externalRef != null && externalRef.PathType == PathType.Absolute)
                        {
                            string linkPath = ModelPathUtils.ConvertModelPathToUserVisiblePath(externalRef.GetAbsolutePath());
                            linkInfo.OriginalPath = linkPath;

                            if (!string.IsNullOrEmpty(linkPath) && File.Exists(linkPath))
                            {
                                progressCallback?.Invoke(30 + (processedLinks * 25 / linkTypes.Count), 
                                    $"Copying link: {Path.GetFileName(linkPath)}...");

                                string linkFileName = Path.GetFileName(linkPath);
                                string destPath = Path.Combine(linksDir, linkFileName);
                                
                                // Handle duplicate names
                                int counter = 1;
                                while (File.Exists(destPath))
                                {
                                    string nameWithoutExt = Path.GetFileNameWithoutExtension(linkFileName);
                                    string ext = Path.GetExtension(linkFileName);
                                    destPath = Path.Combine(linksDir, $"{nameWithoutExt}_{counter}{ext}");
                                    counter++;
                                }

                                File.Copy(linkPath, destPath, true);
                                linkInfo.CopiedAs = Path.GetFileName(destPath);
                                linkInfo.Status = "Included";
                                linkInfo.FileSize = new FileInfo(linkPath).Length;
                                result.IncludedLinks.Add(linkInfo);
                            }
                            else
                            {
                                linkInfo.Status = "NotFound";
                                linkInfo.Error = "File not found at path";
                                result.MissingLinks.Add(linkInfo);
                            }
                        }
                        else if (externalRef != null)
                        {
                            // Cloud or server link
                            linkInfo.Status = "CloudOrServer";
                            linkInfo.Error = "Cloud/server links cannot be copied automatically";
                            result.MissingLinks.Add(linkInfo);
                        }
                        else
                        {
                            linkInfo.Status = "NoReference";
                            linkInfo.Error = "Could not resolve link reference";
                            result.MissingLinks.Add(linkInfo);
                        }
                    }
                    catch (Exception ex)
                    {
                        linkInfo.Status = "Error";
                        linkInfo.Error = ex.Message;
                        result.MissingLinks.Add(linkInfo);
                    }
                }

                // Also try to get CAD links (DWG, DGN, etc.)
                var cadLinks = new FilteredElementCollector(document)
                    .OfClass(typeof(CADLinkType))
                    .Cast<CADLinkType>()
                    .ToList();

                foreach (var cadLink in cadLinks)
                {
                    var linkInfo = new LinkedFileInfo
                    {
                        Name = cadLink.Name,
                        Type = "CADLink"
                    };

                    try
                    {
                        var externalRef = cadLink.GetExternalFileReference();
                        if (externalRef != null)
                        {
                            string linkPath = ModelPathUtils.ConvertModelPathToUserVisiblePath(externalRef.GetAbsolutePath());
                            linkInfo.OriginalPath = linkPath;

                            if (!string.IsNullOrEmpty(linkPath) && File.Exists(linkPath))
                            {
                                string linkFileName = Path.GetFileName(linkPath);
                                string destPath = Path.Combine(linksDir, linkFileName);
                                
                                int counter = 1;
                                while (File.Exists(destPath))
                                {
                                    string nameWithoutExt = Path.GetFileNameWithoutExtension(linkFileName);
                                    string ext = Path.GetExtension(linkFileName);
                                    destPath = Path.Combine(linksDir, $"{nameWithoutExt}_{counter}{ext}");
                                    counter++;
                                }

                                File.Copy(linkPath, destPath, true);
                                linkInfo.CopiedAs = Path.GetFileName(destPath);
                                linkInfo.Status = "Included";
                                linkInfo.FileSize = new FileInfo(linkPath).Length;
                                result.IncludedLinks.Add(linkInfo);
                            }
                            else
                            {
                                linkInfo.Status = "NotFound";
                                result.MissingLinks.Add(linkInfo);
                            }
                        }
                    }
                    catch
                    {
                        linkInfo.Status = "Error";
                        result.MissingLinks.Add(linkInfo);
                    }
                }
            }
            catch (Exception ex)
            {
                result.CollectionError = ex.Message;
            }

            return result;
        }

        private void CreateManifest(Document document, List<ElementId> selectedSheetIds, 
            LinkCollectionResult linkInfo, string manifestPath)
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
                sheets = sheets,
                links = new
                {
                    included = linkInfo.IncludedLinks.Select(l => new
                    {
                        name = l.Name,
                        type = l.Type,
                        copiedAs = l.CopiedAs,
                        originalPath = l.OriginalPath,
                        fileSize = l.FileSize
                    }),
                    missing = linkInfo.MissingLinks.Select(l => new
                    {
                        name = l.Name,
                        type = l.Type,
                        status = l.Status,
                        originalPath = l.OriginalPath,
                        error = l.Error
                    }),
                    collectionError = linkInfo.CollectionError
                }
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

    public class LinkCollectionResult
    {
        public List<LinkedFileInfo> IncludedLinks { get; set; } = new List<LinkedFileInfo>();
        public List<LinkedFileInfo> MissingLinks { get; set; } = new List<LinkedFileInfo>();
        public string CollectionError { get; set; }
    }

    public class LinkedFileInfo
    {
        public string Name { get; set; }
        public string Type { get; set; }
        public string OriginalPath { get; set; }
        public string CopiedAs { get; set; }
        public string Status { get; set; }
        public string Error { get; set; }
        public long FileSize { get; set; }
    }
}
