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

    /// <summary>
    /// Result from background packaging that needs main thread follow-up
    /// </summary>
    public class PackageResult
    {
        public string ZipPath { get; set; }
        public LinkCollectionResult LinkResults { get; set; }
        public string ModelCopyPath { get; set; }
        
        /// <summary>
        /// Number of cloud-hosted links detected (BIM 360, ACC, etc.)
        /// Used to warn users before upload that these files won't be included
        /// </summary>
        public int CloudLinksDetected => LinkResults?.CloudLinks?.Count ?? 0;
    }

    public class LinkToCopy
    {
        public string SourcePath { get; set; }
        public string DestFileName { get; set; }
        public string Name { get; set; }
        public string Type { get; set; }
        public bool IsCloud { get; set; }
        /// <summary>
        /// True if this file was skipped (e.g., point cloud, too large)
        /// </summary>
        public bool IsSkipped { get; set; }
        /// <summary>
        /// Reason the file was skipped (e.g., "Point cloud - too large")
        /// </summary>
        public string SkipReason { get; set; }
    }

    public class PackagingService
    {
        private string _tempDir;
        private string _zipPath;
        private bool _tempDirCleaned = false;

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
                throw new InvalidOperationException("The model must be saved to a file before uploading. Please save your Revit model first.");
            }

            // Check for BIM 360/ACC cloud models - these require special handling
            // Cloud paths look like "BIM 360://..." or "autodesk.docs://..."
            if (originalPath.StartsWith("BIM 360://", StringComparison.OrdinalIgnoreCase) ||
                originalPath.StartsWith("autodesk.docs://", StringComparison.OrdinalIgnoreCase) ||
                originalPath.StartsWith("ACC://", StringComparison.OrdinalIgnoreCase))
            {
                var result = System.Windows.MessageBox.Show(
                    "This model appears to be stored in BIM 360 or Autodesk Construction Cloud.\n\n" +
                    "Cloud models may require additional steps:\n" +
                    "1. Ensure you have a local cache of the model\n" +
                    "2. Large models may take longer to package\n" +
                    "3. Check your internet connection is stable\n\n" +
                    "If upload fails, try creating a local copy first:\n" +
                    "File > Save As > Local File (.rvt)\n\n" +
                    "Do you want to continue anyway?",
                    "Cloud Model Detected",
                    System.Windows.MessageBoxButton.YesNo,
                    System.Windows.MessageBoxImage.Warning);

                if (result != System.Windows.MessageBoxResult.Yes)
                {
                    throw new OperationCanceledException("Upload cancelled by user.");
                }
            }

            // Warn about unsaved changes (but allow continuing)
            if (document.IsModified)
            {
                var result = System.Windows.MessageBox.Show(
                    "Your model has unsaved changes.\n\n" +
                    "Only the last saved version will be uploaded. Your unsaved changes will NOT be included.\n\n" +
                    "Do you want to continue?",
                    "Unsaved Changes",
                    System.Windows.MessageBoxButton.YesNo,
                    System.Windows.MessageBoxImage.Warning);

                if (result != System.Windows.MessageBoxResult.Yes)
                {
                    throw new OperationCanceledException("Upload cancelled by user.");
                }
            }

            var data = new PackageData();
            data.TempDir = Path.Combine(Path.GetTempPath(), "LOD400Upload_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(data.TempDir);
            _tempDir = data.TempDir;
            _tempDirCleaned = false; // Reset cleanup flag for new packaging operation

            string fileName = Path.GetFileName(originalPath);
            data.OriginalFileName = fileName;
            data.ModelCopyPath = Path.Combine(data.TempDir, fileName);

            bool isWorkshared = document.IsWorkshared;
            bool isCloudModel = IsCloudPath(originalPath);
            
            string progressMessage = isWorkshared 
                ? "Creating detached copy of workshared model..." 
                : isCloudModel 
                    ? "Downloading cloud model..." 
                    : "Copying model file...";
            progressCallback?.Invoke(20, progressMessage);
            
            // SAFE APPROACH: Copy file first, then open the copy in background
            // This prevents "Session Hijack" where SaveAs switches the user's active document
            
            if (isWorkshared || isCloudModel)
            {
                // For workshared models: File is locked by Revit server, must use OpenDocumentFile
                // For cloud models (BIM 360/ACC): File.Copy doesn't work on cloud paths
                // Both cases: Open document in background and SaveAs to local temp folder
                ModelPath modelPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(originalPath);
                OpenOptions openOptions = new OpenOptions();
                
                // Only set detach option for workshared models
                if (isWorkshared)
                {
                    openOptions.DetachFromCentralOption = DetachFromCentralOption.DetachAndPreserveWorksets;
                }
                
                // Open the copy in background (this does NOT affect the user's active document)
                Document backgroundDoc = document.Application.OpenDocumentFile(modelPath, openOptions);
                
                try
                {
                    progressCallback?.Invoke(30, "Saving local copy...");
                    
                    // Save the copy to our temp folder
                    SaveAsOptions saveOptions = new SaveAsOptions();
                    saveOptions.OverwriteExistingFile = true;
                    saveOptions.MaximumBackups = 1;
                    
                    // For workshared models: Mark as non-workshared for the copy
                    if (isWorkshared)
                    {
                        WorksharingSaveAsOptions wsOptions = new WorksharingSaveAsOptions();
                        wsOptions.SaveAsCentral = false;
                        saveOptions.SetWorksharingOptions(wsOptions);
                    }
                    
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
                // For local non-workshared models, simple File.Copy works fine
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
        /// NOTE: Does NOT call TransmissionData API - that must be done on main thread
        /// Call FinalizePackageOnMainThread after this completes
        /// </summary>
        public PackageResult CreatePackageWithoutRepathing(PackageData data, Action<int, string> progressCallback)
        {
            _tempDir = data.TempDir;
            _zipPath = null;

            // Note: Cleanup is NOT done here on failure - caller owns cleanup responsibility
            // This prevents double-cleanup issues when exceptions propagate up the call stack
            
            // Copy linked files (excluding skipped heavyweight files)
            progressCallback?.Invoke(10, "Copying linked files...");
            string linksDir = Path.Combine(data.TempDir, "Links");
            // Filter out skipped links BEFORE passing to CopyLinkFiles - they should not be copied
            var linksToCopy = data.LinksToCopy.Where(l => !l.IsSkipped).ToList();
            var skippedLinks = data.LinksToCopy.Where(l => l.IsSkipped).ToList();
            var linkResults = CopyLinkFiles(linksToCopy, linksDir, progressCallback);
            
            // Add skipped links to the results so they appear in the manifest
            foreach (var skipped in skippedLinks)
            {
                linkResults.SkippedLinks.Add(new LinkedFileInfo
                {
                    Name = skipped.Name,
                    Type = skipped.Type,
                    OriginalPath = skipped.SourcePath,
                    Status = "Skipped",
                    IsCloud = skipped.IsCloud,
                    Error = skipped.SkipReason
                });
            }

            // Update manifest with actual link copy results
            progressCallback?.Invoke(55, "Writing manifest...");
            string updatedManifest = UpdateManifestWithLinkResults(data.ManifestJson, linkResults);
            string manifestPath = Path.Combine(data.TempDir, "manifest.json");
            File.WriteAllText(manifestPath, updatedManifest);

            // Return result for main thread to do TransmissionData work
            return new PackageResult
            {
                ZipPath = null, // Will be set in FinalizePackage
                LinkResults = linkResults,
                ModelCopyPath = data.ModelCopyPath
            };
        }

        /// <summary>
        /// Updates the manifest JSON with actual link copy results
        /// Preserves existing manifest structure and adds copy outcomes
        /// </summary>
        private string UpdateManifestWithLinkResults(string manifestJson, LinkCollectionResult linkResults)
        {
            try
            {
                var manifest = Newtonsoft.Json.JsonConvert.DeserializeObject<Newtonsoft.Json.Linq.JObject>(manifestJson);
                
                // Preserve existing links.toInclude array and add copy outcomes as a new property
                var linksSection = manifest["links"] as Newtonsoft.Json.Linq.JObject;
                if (linksSection == null)
                {
                    linksSection = new Newtonsoft.Json.Linq.JObject();
                    manifest["links"] = linksSection;
                }
                
                // Add copy results without overwriting existing toInclude/cloudHosted arrays
                // Note: Cloud links are already in links.cloudHosted from CreateManifestJson
                // copyResults contains local link copy outcomes (success/failure) plus skipped heavyweight files
                linksSection["copyResults"] = Newtonsoft.Json.Linq.JToken.FromObject(new
                {
                    included = linkResults.IncludedLinks.Select(l => new
                    {
                        name = l.Name,
                        type = l.Type,
                        originalPath = l.OriginalPath,
                        copiedAs = l.CopiedAs
                    }),
                    failed = linkResults.MissingLinks.Select(l => new
                    {
                        name = l.Name,
                        type = l.Type,
                        originalPath = l.OriginalPath,
                        error = l.Error
                    }),
                    cloudSkipped = linkResults.CloudLinks.Count,
                    // Heavyweight files (point clouds, coordination models) that exist but were not included
                    // Admin should request these files separately from the client if needed
                    skippedFiles = linkResults.SkippedLinks.Select(l => new
                    {
                        name = l.Name,
                        type = l.Type,
                        originalPath = l.OriginalPath,
                        isCloud = l.IsCloud,
                        reason = l.Error  // Error field contains the skip reason
                    })
                });
                
                return manifest.ToString(Newtonsoft.Json.Formatting.Indented);
            }
            catch
            {
                // If update fails, return original manifest
                return manifestJson;
            }
        }

        /// <summary>
        /// Phase 3: TransmissionData operations (MUST run on main thread)
        /// This uses Revit API for re-pathing links and must not run on background thread
        /// </summary>
        public void RepathLinksOnMainThread(PackageResult result, Action<int, string> progressCallback)
        {
            progressCallback?.Invoke(60, "Re-pathing links for portability...");
            RepathLinksForTransmission(result.ModelCopyPath, result.LinkResults);
        }

        /// <summary>
        /// Phase 4: Final ZIP creation (can run on background thread)
        /// Creates the ZIP archive after repathing is done
        /// </summary>
        public string FinalizePackage(PackageData data, Action<int, string> progressCallback)
        {
            try
            {
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
        /// Legacy method for backward compatibility - combines all phases
        /// WARNING: If called from background thread, may crash due to TransmissionData API
        /// Prefer using CreatePackageWithoutRepathing + RepathLinksOnMainThread + FinalizePackage
        /// </summary>
        [Obsolete("Use CreatePackageWithoutRepathing + RepathLinksOnMainThread + FinalizePackage instead")]
        public string CreatePackage(PackageData data, Action<int, string> progressCallback)
        {
            var result = CreatePackageWithoutRepathing(data, progressCallback);
            RepathLinksOnMainThread(result, progressCallback);
            return FinalizePackage(data, progressCallback);
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

        /// <summary>
        /// Checks if a path is a cloud path (BIM 360, ACC, etc.)
        /// Cloud paths cannot be accessed with standard File.Copy operations
        /// </summary>
        private static bool IsCloudPath(string path)
        {
            if (string.IsNullOrEmpty(path)) return false;
            return path.StartsWith("BIM 360://", StringComparison.OrdinalIgnoreCase) ||
                   path.StartsWith("autodesk.docs://", StringComparison.OrdinalIgnoreCase) ||
                   path.StartsWith("ACC://", StringComparison.OrdinalIgnoreCase);
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
                            
                            if (string.IsNullOrEmpty(linkPath)) continue;
                            
                            // Check if this is a cloud-hosted link (BIM 360, ACC, etc.)
                            // Cloud links cannot be copied with File.Copy but we record them in the manifest
                            if (IsCloudPath(linkPath))
                            {
                                string cloudFileName = linkPath.Split('/').LastOrDefault() ?? linkPath;
                                // Track heavyweight cloud files as skipped (not silently ignored)
                                if (IsHeavyweightFile(cloudFileName))
                                {
                                    links.Add(new LinkToCopy
                                    {
                                        SourcePath = linkPath,
                                        DestFileName = cloudFileName,
                                        Name = linkType.Name,
                                        Type = "RevitLink",
                                        IsCloud = true,
                                        IsSkipped = true,
                                        SkipReason = $"Heavyweight file ({Path.GetExtension(cloudFileName)}) - point cloud or coordination model"
                                    });
                                    continue;
                                }

                                links.Add(new LinkToCopy
                                {
                                    SourcePath = linkPath,
                                    DestFileName = cloudFileName,
                                    Name = linkType.Name,
                                    Type = "RevitLink",
                                    IsCloud = true
                                });
                                continue;
                            }
                            
                            // CRITICAL FIX: Resolve relative paths before checking existence
                            // Without this, File.Exists("..\Structure.rvt") checks relative to Revit.exe folder
                            // instead of the project folder, causing links to be silently skipped
                            // ALSO: Only attempt path resolution for local files - cloud models have URI paths
                            // that Path.GetDirectoryName cannot parse (e.g., "BIM 360://Project/Model.rvt")
                            if (!Path.IsPathRooted(linkPath) && !string.IsNullOrEmpty(document.PathName) && !document.IsModelInCloud)
                            {
                                try
                                {
                                    string hostFolder = Path.GetDirectoryName(document.PathName);
                                    if (!string.IsNullOrEmpty(hostFolder))
                                    {
                                        linkPath = Path.GetFullPath(Path.Combine(hostFolder, linkPath));
                                    }
                                }
                                catch { /* Path operations failed - use original linkPath */ }
                            }
                            
                            if (File.Exists(linkPath))
                            {
                                // Track heavyweight files as skipped (not silently ignored)
                                if (IsHeavyweightFile(linkPath))
                                {
                                    links.Add(new LinkToCopy
                                    {
                                        SourcePath = linkPath,
                                        DestFileName = Path.GetFileName(linkPath),
                                        Name = linkType.Name,
                                        Type = "RevitLink",
                                        IsCloud = false,
                                        IsSkipped = true,
                                        SkipReason = $"Heavyweight file ({Path.GetExtension(linkPath)}) - point cloud or coordination model"
                                    });
                                    continue;
                                }

                                links.Add(new LinkToCopy
                                {
                                    SourcePath = linkPath,
                                    DestFileName = Path.GetFileName(linkPath),
                                    Name = linkType.Name,
                                    Type = "RevitLink",
                                    IsCloud = false
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
                            
                            if (string.IsNullOrEmpty(linkPath)) continue;
                            
                            // Check if this is a cloud-hosted link
                            if (IsCloudPath(linkPath))
                            {
                                string cloudFileName = linkPath.Split('/').LastOrDefault() ?? linkPath;
                                // Track heavyweight cloud files as skipped
                                if (IsHeavyweightFile(cloudFileName))
                                {
                                    links.Add(new LinkToCopy
                                    {
                                        SourcePath = linkPath,
                                        DestFileName = cloudFileName,
                                        Name = cadLink.Name,
                                        Type = "CADLink",
                                        IsCloud = true,
                                        IsSkipped = true,
                                        SkipReason = $"Heavyweight file ({Path.GetExtension(cloudFileName)}) - point cloud or coordination model"
                                    });
                                    continue;
                                }

                                links.Add(new LinkToCopy
                                {
                                    SourcePath = linkPath,
                                    DestFileName = cloudFileName,
                                    Name = cadLink.Name,
                                    Type = "CADLink",
                                    IsCloud = true
                                });
                                continue;
                            }
                            
                            // CRITICAL FIX: Resolve relative paths before checking existence
                            // Only attempt path resolution for local files - cloud models have URI paths
                            if (!Path.IsPathRooted(linkPath) && !string.IsNullOrEmpty(document.PathName) && !document.IsModelInCloud)
                            {
                                try
                                {
                                    string hostFolder = Path.GetDirectoryName(document.PathName);
                                    if (!string.IsNullOrEmpty(hostFolder))
                                    {
                                        linkPath = Path.GetFullPath(Path.Combine(hostFolder, linkPath));
                                    }
                                }
                                catch { /* Path operations failed - use original linkPath */ }
                            }
                            
                            if (File.Exists(linkPath))
                            {
                                // Track heavyweight files as skipped
                                if (IsHeavyweightFile(linkPath))
                                {
                                    links.Add(new LinkToCopy
                                    {
                                        SourcePath = linkPath,
                                        DestFileName = Path.GetFileName(linkPath),
                                        Name = cadLink.Name,
                                        Type = "CADLink",
                                        IsCloud = false,
                                        IsSkipped = true,
                                        SkipReason = $"Heavyweight file ({Path.GetExtension(linkPath)}) - point cloud or coordination model"
                                    });
                                    continue;
                                }

                                links.Add(new LinkToCopy
                                {
                                    SourcePath = linkPath,
                                    DestFileName = Path.GetFileName(linkPath),
                                    Name = cadLink.Name,
                                    Type = "CADLink",
                                    IsCloud = false
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

            // Separate cloud and local links
            var localLinks = links.Where(l => !l.IsCloud).ToList();
            var cloudLinks = links.Where(l => l.IsCloud).ToList();
            
            // Record cloud links (they exist but can't be copied)
            foreach (var cloudLink in cloudLinks)
            {
                result.CloudLinks.Add(new LinkedFileInfo
                {
                    Name = cloudLink.Name,
                    Type = cloudLink.Type,
                    OriginalPath = cloudLink.SourcePath,
                    Status = "CloudHosted",
                    IsCloud = true,
                    Error = "Cloud-hosted files cannot be copied. Please download locally or ensure team has access."
                });
            }

            if (localLinks.Count == 0)
            {
                return result;
            }

            Directory.CreateDirectory(linksDir);
            int processed = 0;

            foreach (var link in localLinks)
            {
                processed++;
                int progress = 10 + (processed * 40 / localLinks.Count);
                progressCallback?.Invoke(progress, $"Copying link: {link.DestFileName}...");

                var linkInfo = new LinkedFileInfo
                {
                    Name = link.Name,
                    Type = link.Type,
                    OriginalPath = link.SourcePath,
                    IsCloud = false
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

            // Separate links into categories for the manifest
            // IMPORTANT: Exclude IsSkipped links from toInclude/cloudHosted - they should only appear in skippedFiles
            var localLinks = links.Where(l => !l.IsCloud && !l.IsSkipped).ToList();
            var cloudLinks = links.Where(l => l.IsCloud && !l.IsSkipped).ToList();
            var skippedLinks = links.Where(l => l.IsSkipped).ToList();

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
                    // Local links that WILL be included in the package
                    toInclude = localLinks.Select(l => new
                    {
                        name = l.Name,
                        type = l.Type,
                        fileName = l.DestFileName,
                        originalPath = l.SourcePath
                    }),
                    // Cloud-hosted links that exist but cannot be copied
                    // Team should download these separately or ensure cloud access
                    cloudHosted = cloudLinks.Select(l => new
                    {
                        name = l.Name,
                        type = l.Type,
                        cloudPath = l.SourcePath,
                        note = "Cloud-hosted file - requires BIM 360/ACC access or local download"
                    }),
                    // Heavyweight files (point clouds, coordination models) that were intentionally skipped
                    // These files EXIST in the original model but are NOT included in the package
                    // Admin should request these files separately from the client if needed
                    skippedFiles = skippedLinks.Select(l => new
                    {
                        name = l.Name,
                        type = l.Type,
                        originalPath = l.SourcePath,
                        fileName = l.DestFileName,
                        isCloud = l.IsCloud,
                        skipReason = l.SkipReason
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

        /// <summary>
        /// Cleans up all temporary resources (temp directory and zip file)
        /// Use this in error handlers to ensure no resources are left behind
        /// </summary>
        public void CleanupAll()
        {
            CleanupTempDirectory();
            CleanupZipFile();
        }

        private void CleanupTempDirectory()
        {
            // Prevent double cleanup which can cause IOException
            if (_tempDirCleaned) return;
            
            if (!string.IsNullOrEmpty(_tempDir) && Directory.Exists(_tempDir))
            {
                try
                {
                    Directory.Delete(_tempDir, true);
                    _tempDirCleaned = true;
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
        public List<LinkedFileInfo> CloudLinks { get; set; } = new List<LinkedFileInfo>();
        /// <summary>
        /// Heavyweight files (point clouds, coordination models) that were intentionally skipped
        /// </summary>
        public List<LinkedFileInfo> SkippedLinks { get; set; } = new List<LinkedFileInfo>();
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
        public bool IsCloud { get; set; }
    }
}
