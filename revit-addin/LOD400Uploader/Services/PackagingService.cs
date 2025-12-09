using System;
using System.IO;
using System.IO.Compression;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace LOD400Uploader.Services
{
    /// <summary>
    /// Data collected from Revit API (must run on main thread)
    /// </summary>
    public class PackageData
    {
        public string TempDir { get; set; }
        public string ModelCopyPath { get; set; }
        public List<LinkToCopy> LinksToCopy { get; set; } = new List<LinkToCopy>();
        public string ManifestJson { get; set; }
        public string OriginalFileName { get; set; }
    }

    public class LinkToCopy
    {
        public string SourcePath { get; set; }
        public string DestFileName { get; set; }
        public string Name { get; set; }
        public string Type { get; set; }
    }

    public class PackagingService
    {
        private string _tempDir;
        private string _zipPath;

        /// <summary>
        /// Phase 1: Collect data using Revit API (MUST run on main thread)
        /// This is fast and returns data needed for file operations
        /// </summary>
        public PackageData PreparePackageData(Document document, List<ElementId> selectedSheetIds, Action<int, string> progressCallback)
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

            var data = new PackageData();
            data.TempDir = Path.Combine(Path.GetTempPath(), "LOD400Upload_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(data.TempDir);
            _tempDir = data.TempDir;

            string fileName = Path.GetFileName(originalPath);
            data.OriginalFileName = fileName;
            data.ModelCopyPath = Path.Combine(data.TempDir, fileName);

            bool isWorkshared = document.IsWorkshared;
            
            progressCallback?.Invoke(20, isWorkshared ? "Creating detached copy of workshared model..." : "Copying model file...");
            
            // Use Revit's SaveAs API instead of File.Copy to avoid file lock issues
            SaveAsOptions saveOptions = new SaveAsOptions();
            saveOptions.OverwriteExistingFile = true;
            saveOptions.MaximumBackups = 1;
            
            if (isWorkshared)
            {
                WorksharingSaveAsOptions wsOptions = new WorksharingSaveAsOptions();
                wsOptions.SaveAsCentral = false;
                saveOptions.SetWorksharingOptions(wsOptions);
            }
            
            document.SaveAs(data.ModelCopyPath, saveOptions);

            progressCallback?.Invoke(40, "Collecting link information...");
            
            // Collect link paths using Revit API (fast)
            data.LinksToCopy = CollectLinkPaths(document);

            progressCallback?.Invoke(60, "Preparing manifest...");
            
            // Create manifest JSON using Revit API
            data.ManifestJson = CreateManifestJson(document, selectedSheetIds, data.LinksToCopy);

            progressCallback?.Invoke(100, "Model data collected");
            
            return data;
        }

        /// <summary>
        /// Phase 2: File operations (can run on background thread)
        /// Copies linked files and creates ZIP archive
        /// </summary>
        public string CreatePackage(PackageData data, Action<int, string> progressCallback)
        {
            _tempDir = data.TempDir;
            _zipPath = null;

            try
            {
                // Copy linked files
                progressCallback?.Invoke(10, "Copying linked files...");
                string linksDir = Path.Combine(data.TempDir, "Links");
                var linkResults = CopyLinkFiles(data.LinksToCopy, linksDir, progressCallback);

                // Write manifest with actual copy results
                progressCallback?.Invoke(60, "Writing manifest...");
                string manifestPath = Path.Combine(data.TempDir, "manifest.json");
                File.WriteAllText(manifestPath, data.ManifestJson);

                // Create ZIP
                progressCallback?.Invoke(70, "Creating ZIP package...");
                _zipPath = Path.Combine(Path.GetTempPath(), $"LOD400_Upload_{DateTime.Now:yyyyMMdd_HHmmss}.zip");
                
                if (File.Exists(_zipPath))
                {
                    File.Delete(_zipPath);
                }

                ZipFile.CreateFromDirectory(data.TempDir, _zipPath, CompressionLevel.Optimal, false);

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

        private List<LinkToCopy> CollectLinkPaths(Document document)
        {
            var links = new List<LinkToCopy>();

            try
            {
                // Get Revit link paths
                var linkTypes = new FilteredElementCollector(document)
                    .OfClass(typeof(RevitLinkType))
                    .Cast<RevitLinkType>()
                    .ToList();

                foreach (var linkType in linkTypes)
                {
                    try
                    {
                        var externalRef = linkType.GetExternalFileReference();
                        if (externalRef != null && externalRef.PathType == PathType.Absolute)
                        {
                            string linkPath = ModelPathUtils.ConvertModelPathToUserVisiblePath(externalRef.GetAbsolutePath());
                            if (!string.IsNullOrEmpty(linkPath) && File.Exists(linkPath))
                            {
                                links.Add(new LinkToCopy
                                {
                                    SourcePath = linkPath,
                                    DestFileName = Path.GetFileName(linkPath),
                                    Name = linkType.Name,
                                    Type = "RevitLink"
                                });
                            }
                        }
                    }
                    catch { }
                }

                // Get CAD link paths
                var cadLinks = new FilteredElementCollector(document)
                    .OfClass(typeof(CADLinkType))
                    .Cast<CADLinkType>()
                    .ToList();

                foreach (var cadLink in cadLinks)
                {
                    try
                    {
                        var externalRef = cadLink.GetExternalFileReference();
                        if (externalRef != null)
                        {
                            string linkPath = ModelPathUtils.ConvertModelPathToUserVisiblePath(externalRef.GetAbsolutePath());
                            if (!string.IsNullOrEmpty(linkPath) && File.Exists(linkPath))
                            {
                                links.Add(new LinkToCopy
                                {
                                    SourcePath = linkPath,
                                    DestFileName = Path.GetFileName(linkPath),
                                    Name = cadLink.Name,
                                    Type = "CADLink"
                                });
                            }
                        }
                    }
                    catch { }
                }
            }
            catch { }

            return links;
        }

        private LinkCollectionResult CopyLinkFiles(List<LinkToCopy> links, string linksDir, Action<int, string> progressCallback)
        {
            var result = new LinkCollectionResult();

            if (links.Count == 0)
            {
                return result;
            }

            Directory.CreateDirectory(linksDir);
            int processed = 0;

            foreach (var link in links)
            {
                processed++;
                int progress = 10 + (processed * 40 / links.Count);
                progressCallback?.Invoke(progress, $"Copying link: {link.DestFileName}...");

                var linkInfo = new LinkedFileInfo
                {
                    Name = link.Name,
                    Type = link.Type,
                    OriginalPath = link.SourcePath
                };

                try
                {
                    string destPath = Path.Combine(linksDir, link.DestFileName);
                    
                    // Handle duplicate names
                    int counter = 1;
                    while (File.Exists(destPath))
                    {
                        string nameWithoutExt = Path.GetFileNameWithoutExtension(link.DestFileName);
                        string ext = Path.GetExtension(link.DestFileName);
                        destPath = Path.Combine(linksDir, $"{nameWithoutExt}_{counter}{ext}");
                        counter++;
                    }

                    File.Copy(link.SourcePath, destPath, true);
                    linkInfo.CopiedAs = Path.GetFileName(destPath);
                    linkInfo.Status = "Included";
                    linkInfo.FileSize = new FileInfo(link.SourcePath).Length;
                    result.IncludedLinks.Add(linkInfo);
                }
                catch (Exception ex)
                {
                    linkInfo.Status = "Error";
                    linkInfo.Error = ex.Message;
                    result.MissingLinks.Add(linkInfo);
                }
            }

            return result;
        }

        private string CreateManifestJson(Document document, List<ElementId> selectedSheetIds, List<LinkToCopy> links)
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
                    toInclude = links.Select(l => new
                    {
                        name = l.Name,
                        type = l.Type,
                        fileName = l.DestFileName,
                        originalPath = l.SourcePath
                    })
                }
            };

            return Newtonsoft.Json.JsonConvert.SerializeObject(manifest, Newtonsoft.Json.Formatting.Indented);
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
