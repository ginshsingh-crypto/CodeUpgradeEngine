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
        /// IMPORTANT: We avoid SaveAs on the active document to prevent "Session Hijack"
        /// where the user's Revit switches to the temp file
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
            
            // SAFE APPROACH: Copy file first, then open the copy in background
            // This prevents "Session Hijack" where SaveAs switches the user's active document
            
            if (isWorkshared)
            {
                // For workshared models, we cannot File.Copy (file is locked by Revit server)
                // Instead, open directly from original with DetachAndPreserveWorksets
                ModelPath modelPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(originalPath);
                OpenOptions openOptions = new OpenOptions();
                openOptions.DetachFromCentralOption = DetachFromCentralOption.DetachAndPreserveWorksets;
                
                // Open the copy in background (this does NOT affect the user's active document)
                Document backgroundDoc = document.Application.OpenDocumentFile(modelPath, openOptions);
                
                try
                {
                    progressCallback?.Invoke(30, "Saving detached copy...");
                    
                    // Save the detached copy to our temp folder
                    SaveAsOptions saveOptions = new SaveAsOptions();
                    saveOptions.OverwriteExistingFile = true;
                    saveOptions.MaximumBackups = 1;
                    
                    // Important: Mark as non-workshared for the copy
                    WorksharingSaveAsOptions wsOptions = new WorksharingSaveAsOptions();
                    wsOptions.SaveAsCentral = false;
                    saveOptions.SetWorksharingOptions(wsOptions);
                    
                    backgroundDoc.SaveAs(data.ModelCopyPath, saveOptions);
                    
                    progressCallback?.Invoke(40, "Collecting link information...");
                    
                    // CRITICAL FIX: Collect links from the ORIGINAL document, not the background copy
                    // Relative links (e.g. ..\Structure.rvt) resolve relative to the document's PathName
                    // The background doc is in %TEMP%, so relative paths would look there (and fail)
                    // The original document has the correct PathName for resolving relative links
                    data.LinksToCopy = CollectLinkPaths(document);
                    
                    progressCallback?.Invoke(60, "Preparing manifest...");
                    
                    // Create manifest JSON from the background document (for sheet info)
                    data.ManifestJson = CreateManifestJson(backgroundDoc, selectedSheetIds, data.LinksToCopy);
                }
                finally
                {
                    // CRITICAL: Close the background document so we can ZIP it later
                    backgroundDoc.Close(false);
                }
            }
            else
            {
                // For non-workshared models, simple File.Copy works fine
                File.Copy(originalPath, data.ModelCopyPath, true);
                
                progressCallback?.Invoke(40, "Collecting link information...");
                
                // Collect link paths from the original document (safe - it's not workshared)
                data.LinksToCopy = CollectLinkPaths(document);
                
                progressCallback?.Invoke(60, "Preparing manifest...");
                
                // Create manifest JSON from the original document
                data.ManifestJson = CreateManifestJson(document, selectedSheetIds, data.LinksToCopy);
            }

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

                // Re-path links using TransmissionData API
                // This ensures links load correctly when opened on a different machine
                progressCallback?.Invoke(55, "Re-pathing links for portability...");
                RepathLinksForTransmission(data.ModelCopyPath, linkResults);

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

        /// <summary>
        /// Extensions that are "heavyweight" and should be skipped
        /// Point clouds and coordination models can be 10-50GB
        /// </summary>
        private static readonly HashSet<string> HeavyweightExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".rcp", ".rcs",  // Point clouds
            ".nwd", ".nwc",  // Navisworks coordination models
            ".pts", ".xyz",  // Point cloud formats
            ".las", ".laz",  // LiDAR formats
            ".e57"           // ASTM point cloud format
        };

        private bool IsHeavyweightFile(string filePath)
        {
            if (string.IsNullOrEmpty(filePath)) return false;
            string ext = Path.GetExtension(filePath);
            return HeavyweightExtensions.Contains(ext);
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
                        if (externalRef != null)
                        {
                            string linkPath = ModelPathUtils.ConvertModelPathToUserVisiblePath(externalRef.GetPath());
                            
                            // CRITICAL FIX: Resolve relative paths before checking existence
                            // Without this, File.Exists("..\Structure.rvt") checks relative to Revit.exe folder
                            // instead of the project folder, causing links to be silently skipped
                            if (!string.IsNullOrEmpty(linkPath) && !Path.IsPathRooted(linkPath) && !string.IsNullOrEmpty(document.PathName))
                            {
                                string hostFolder = Path.GetDirectoryName(document.PathName);
                                linkPath = Path.GetFullPath(Path.Combine(hostFolder, linkPath));
                            }
                            
                            if (!string.IsNullOrEmpty(linkPath) && File.Exists(linkPath))
                            {
                                // Skip heavyweight files (point clouds, coordination models)
                                if (IsHeavyweightFile(linkPath))
                                {
                                    continue;
                                }

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

                // Get CAD link paths (DWG, DXF, etc. - these are usually small)
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
                            string linkPath = ModelPathUtils.ConvertModelPathToUserVisiblePath(externalRef.GetPath());
                            
                            // CRITICAL FIX: Resolve relative paths before checking existence
                            if (!string.IsNullOrEmpty(linkPath) && !Path.IsPathRooted(linkPath) && !string.IsNullOrEmpty(document.PathName))
                            {
                                string hostFolder = Path.GetDirectoryName(document.PathName);
                                linkPath = Path.GetFullPath(Path.Combine(hostFolder, linkPath));
                            }
                            
                            if (!string.IsNullOrEmpty(linkPath) && File.Exists(linkPath))
                            {
                                // Skip heavyweight files
                                if (IsHeavyweightFile(linkPath))
                                {
                                    continue;
                                }

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

        /// <summary>
        /// Re-path links using TransmissionData API
        /// This ensures links load correctly when opened on a different machine
        /// </summary>
        private void RepathLinksForTransmission(string modelCopyPath, LinkCollectionResult linkResults)
        {
            try
            {
                // Read transmission data from the saved model copy
                ModelPath modelPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(modelCopyPath);
                TransmissionData transData = TransmissionData.ReadTransmissionData(modelPath);
                if (transData == null) return;

                bool isModified = false;
                
                // Build a lookup of copied files by original path
                var copiedFilesByOriginal = linkResults.IncludedLinks
                    .Where(l => !string.IsNullOrEmpty(l.OriginalPath) && !string.IsNullOrEmpty(l.CopiedAs))
                    .ToDictionary(l => l.OriginalPath, l => l.CopiedAs, StringComparer.OrdinalIgnoreCase);

                foreach (ElementId id in transData.GetAllExternalFileReferenceIds())
                {
                    try
                    {
                        ExternalFileReference refData = transData.GetLastSavedReferenceData(id);
                        if (refData == null) continue;

                        // Only re-path Revit links (not IFC, DWG, etc.)
                        if (refData.ExternalFileReferenceType == ExternalFileReferenceType.RevitLink)
                        {
                            string originalPath = ModelPathUtils.ConvertModelPathToUserVisiblePath(refData.GetAbsolutePath());
                            
                            // Check if we copied this link
                            if (copiedFilesByOriginal.TryGetValue(originalPath, out string copiedFileName))
                            {
                                // Create relative path to Links folder
                                string newPath = "Links\\" + copiedFileName;
                                ModelPath newModelPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(newPath);
                                
                                transData.SetDesiredReferenceData(id, newModelPath, PathType.Relative, true);
                                isModified = true;
                            }
                        }
                    }
                    catch { }
                }

                if (isModified)
                {
                    // Mark as transmitted - tells Revit to check relative paths first
                    transData.IsTransmitted = true;
                    TransmissionData.WriteTransmissionData(modelPath, transData);
                }
            }
            catch
            {
                // TransmissionData might fail on some model types - that's OK
                // Links will still work, just need manual re-pathing
            }
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

            // Collect detailed environment info for version compatibility warnings
            var app = document.Application;
            var environment = new
            {
                revitVersion = app?.VersionNumber ?? "Unknown",     // e.g., "2023"
                revitBuild = app?.VersionBuild ?? "Unknown",        // e.g., "2023.1.2"
                revitProduct = app?.VersionName ?? "Unknown",       // e.g., "Autodesk Revit 2023"
                language = app?.Language.ToString() ?? "Unknown",
                username = app?.Username ?? "Unknown"
            };

            var manifest = new
            {
                projectName = document.Title ?? "Untitled",
                projectNumber = GetProjectInfo(document, BuiltInParameter.PROJECT_NUMBER),
                clientName = GetProjectInfo(document, BuiltInParameter.CLIENT_NAME),
                exportDate = DateTime.UtcNow.ToString("o"),
                isWorkshared = document.IsWorkshared,
                sheetCount = sheets.Count,
                sheets = sheets,
                environment = environment,  // Detailed environment for version warnings
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
