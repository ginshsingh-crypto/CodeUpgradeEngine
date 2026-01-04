using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Autodesk.Revit.DB;
using LOD400Uploader.Models;
using LOD400Uploader.Services;

namespace LOD400Uploader.Views
{
    public partial class UploadDialog : Window
    {
        private readonly Document _document;
        private readonly ObservableCollection<SheetItem> _sheets;
        private readonly ApiService _apiService;
        private readonly PackagingService _packagingService;
        
        // Cancellation token for the current upload operation
        private System.Threading.CancellationTokenSource _uploadCancellation;
        
        // Flag to indicate if we're currently in the upload phase (after packaging)
        private bool _isUploading = false;

        // P/Invoke for getting system memory info (works on .NET Framework 4.8)
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private class MEMORYSTATUSEX
        {
            public uint dwLength;
            public uint dwMemoryLoad;
            public ulong ullTotalPhys;
            public ulong ullAvailPhys;
            public ulong ullTotalPageFile;
            public ulong ullAvailPageFile;
            public ulong ullTotalVirtual;
            public ulong ullAvailVirtual;
            public ulong ullAvailExtendedVirtual;

            public MEMORYSTATUSEX()
            {
                this.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
            }
        }

        [return: MarshalAs(UnmanagedType.Bool)]
        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX lpBuffer);

        public UploadDialog(Document document) : this(document, null) { }

        public UploadDialog(Document document, ApiService apiService)
        {
            InitializeComponent();
            _document = document;
            _sheets = new ObservableCollection<SheetItem>();
            _apiService = apiService ?? new ApiService();
            _packagingService = new PackagingService();

            LoadSheets();
        }

        private void LoadSheets()
        {
            try
            {
                var collector = new FilteredElementCollector(_document)
                    .OfClass(typeof(ViewSheet))
                    .Cast<ViewSheet>()
                    .Where(s => s != null && !s.IsPlaceholder)
                    .OrderBy(s => s.SheetNumber ?? "");

                foreach (var sheet in collector)
                {
                    _sheets.Add(new SheetItem
                    {
                        ElementId = sheet.Id,
                        SheetNumber = sheet.SheetNumber ?? "",
                        SheetName = sheet.Name ?? "",
                        Revision = GetRevision(sheet),
                        IsSelected = false
                    });
                }

                SheetListView.ItemsSource = _sheets;
                UpdateSummary();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error loading sheets: {ex.Message}", "Error", 
                    MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private string GetRevision(ViewSheet sheet)
        {
            try
            {
                var param = sheet?.get_Parameter(BuiltInParameter.SHEET_CURRENT_REVISION);
                return param?.AsString() ?? "";
            }
            catch
            {
                return "";
            }
        }

        private void UpdateSummary()
        {
            int selectedCount = _sheets.Count(s => s.IsSelected);
            SelectedCountText.Text = $"{selectedCount} sheets selected";
            SheetCountRun.Text = selectedCount.ToString();
            UploadButton.IsEnabled = selectedCount > 0;
        }

        private void SelectAllCheckBox_Click(object sender, RoutedEventArgs e)
        {
            bool isChecked = SelectAllCheckBox.IsChecked ?? false;
            foreach (var sheet in _sheets)
            {
                sheet.IsSelected = isChecked;
            }
            SheetListView.Items.Refresh();
            UpdateSummary();
        }

        private void SheetCheckBox_Click(object sender, RoutedEventArgs e)
        {
            UpdateSummary();
            
            bool allSelected = _sheets.All(s => s.IsSelected);
            bool noneSelected = !_sheets.Any(s => s.IsSelected);
            
            if (allSelected)
                SelectAllCheckBox.IsChecked = true;
            else if (noneSelected)
                SelectAllCheckBox.IsChecked = false;
            else
                SelectAllCheckBox.IsChecked = null;
        }

        private void SheetListView_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            UpdateSummary();
        }

        private void CancelButton_Click(object sender, RoutedEventArgs e)
        {
            // If we're uploading, cancel the upload
            if (_isUploading && _uploadCancellation != null)
            {
                var result = MessageBox.Show(
                    "Are you sure you want to cancel the upload?\n\n" +
                    "You can resume the upload later.",
                    "Cancel Upload?",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Question);
                
                if (result == MessageBoxResult.Yes)
                {
                    _uploadCancellation.Cancel();
                }
                return;
            }
            
            Close();
        }
        
        protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
        {
            base.OnClosing(e);
            
            // If we're uploading, cancel it when window closes
            if (_isUploading && _uploadCancellation != null)
            {
                _uploadCancellation.Cancel();
            }
        }

        private void ShowProgress()
        {
            ProgressPanel.Visibility = System.Windows.Visibility.Visible;
            SummaryText.Visibility = System.Windows.Visibility.Collapsed;
        }

        private void HideProgress()
        {
            ProgressPanel.Visibility = System.Windows.Visibility.Collapsed;
            SummaryText.Visibility = System.Windows.Visibility.Visible;
        }

        /// <summary>
        /// Clears the stored session config and prompts user to re-login.
        /// Called when the server returns 401 Unauthorized (expired/invalid token).
        /// </summary>
        private void ClearConfigAndRelogin()
        {
            try
            {
                // Delete the config file containing the expired token
                string configPath = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "LOD400Uploader",
                    "config.json");
                if (System.IO.File.Exists(configPath))
                {
                    System.IO.File.Delete(configPath);
                }
            }
            catch { /* Ignore deletion errors */ }

            HideProgress();
            UploadButton.IsEnabled = true;
            CancelButton.IsEnabled = true;

            MessageBox.Show(
                "Your session has expired.\n\nPlease sign in again to continue.",
                "Session Expired",
                MessageBoxButton.OK,
                MessageBoxImage.Information);

            // Show login dialog
            var loginDialog = new LoginDialog();
            if (loginDialog.ShowDialog() == true && loginDialog.IsAuthenticated)
            {
                _apiService.LoadFromConfig();
                // User can now click Upload again
            }
        }

        private async void UploadButton_Click(object sender, RoutedEventArgs e)
        {
            var selectedSheets = _sheets.Where(s => s.IsSelected).ToList();
            if (selectedSheets.Count == 0)
            {
                MessageBox.Show("Please select at least one sheet.", "No Sheets Selected", 
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            if (!_apiService.HasSession)
            {
                _apiService.LoadFromConfig();
                
                if (!_apiService.HasSession)
                {
                    var loginDialog = new LoginDialog();
                    if (loginDialog.ShowDialog() != true || !loginDialog.IsAuthenticated)
                    {
                        return;
                    }
                    _apiService.LoadFromConfig();
                }
            }

            UploadButton.IsEnabled = false;
            CancelButton.IsEnabled = false;
            ShowProgress();

            string packagePath = null;

            try
            {
                // Memory warning before packaging large models (P/Invoke GlobalMemoryStatusEx)
                ulong availableSystemMemoryMB = 4096; // Fail-safe default
                try
                {
                    MEMORYSTATUSEX memStatus = new MEMORYSTATUSEX();
                    if (GlobalMemoryStatusEx(memStatus))
                    {
                        availableSystemMemoryMB = memStatus.ullAvailPhys / (1024 * 1024);
                    }
                }
                catch { }

                // Warn if less than 2GB free
                if (availableSystemMemoryMB < 2048)
                {
                    var result = MessageBox.Show(
                        $"Low system memory detected ({availableSystemMemoryMB} MB available).\n\n" +
                        "Packaging large workshared models may cause Revit to become unresponsive or crash.\n\n" +
                        "Recommendations:\n" +
                        "• Close other applications\n" +
                        "• Save your work before continuing\n" +
                        "• Consider using a machine with more RAM\n\n" +
                        "Do you want to continue anyway?",
                        "Low Memory Warning",
                        MessageBoxButton.YesNo,
                        MessageBoxImage.Warning);

                    if (result != MessageBoxResult.Yes)
                    {
                        HideProgress();
                        UploadButton.IsEnabled = true;
                        CancelButton.IsEnabled = true;
                        return;
                    }
                }

                ProgressText.Text = "Creating order...";
                ProgressBar.Value = 5;

                // Convert selected sheets to SheetInfo for server storage
                var sheetInfoList = selectedSheets.Select(s => new SheetInfo
                {
                    SheetElementId = s.ElementId.Value.ToString(),
                    SheetNumber = s.SheetNumber,
                    SheetName = s.SheetName
                }).ToList();

                CreateOrderResponse orderResponse;
                try
                {
                    orderResponse = await _apiService.CreateOrderAsync(selectedSheets.Count, sheetInfoList);
                }
                catch (ApiUnauthorizedException)
                {
                    // Session expired - clear config and prompt re-login
                    ClearConfigAndRelogin();
                    return;
                }
                var order = orderResponse.Order;

                if (!string.IsNullOrEmpty(orderResponse.CheckoutUrl))
                {
                    ProgressText.Text = "Opening payment page...";
                    ProgressBar.Value = 10;

                    Process.Start(new ProcessStartInfo
                    {
                        FileName = orderResponse.CheckoutUrl,
                        UseShellExecute = true
                    });

                    MessageBox.Show(
                        "A payment page has been opened in your browser.\n\n" +
                        "Please complete the payment, then click OK to continue.",
                        "Complete Payment",
                        MessageBoxButton.OK,
                        MessageBoxImage.Information);

                    ProgressText.Text = "Checking payment...";
                    ProgressBar.IsIndeterminate = true;

                    order = await _apiService.PollOrderStatusAsync(order.Id, maxAttempts: 60, delayMs: 2000);
                    ProgressBar.IsIndeterminate = false;
                }

                if (order.Status != "paid" && order.Status != "uploaded" && 
                    order.Status != "processing" && order.Status != "complete")
                {
                    throw new InvalidOperationException($"Payment not confirmed. Please try again.");
                }

                ProgressText.Text = "Packaging model...";
                ProgressBar.Value = 20;

                var selectedIds = selectedSheets.Select(s => s.ElementId).ToList();
                
                // Phase 1: Revit API operations (must run on main thread)
                // This collects model info and creates a detached copy
                var packageData = _packagingService.PreparePackageData(_document, selectedIds, (progress, message) =>
                {
                    ProgressText.Text = message;
                    ProgressBar.Value = 20 + (progress * 0.2);
                });

                // Phase 2: File operations (run on background thread to prevent UI freeze)
                // This copies linked files but does NOT call TransmissionData API
                PackageResult packageResult = await Task.Run(() =>
                {
                    return _packagingService.CreatePackageWithoutRepathing(packageData, (progress, message) =>
                    {
                        Dispatcher.Invoke(() =>
                        {
                            ProgressText.Text = message;
                            ProgressBar.Value = 40 + (progress * 0.15);
                        });
                    });
                });

                // Check for cloud links and warn user if model depends on them
                // Use Dispatcher.Invoke to ensure MessageBox runs on the UI thread (required for WPF/Revit)
                if (packageResult.CloudLinksDetected > 0)
                {
                    bool userCancelled = false;
                    Dispatcher.Invoke(() =>
                    {
                        var cloudWarningResult = MessageBox.Show(
                            $"⚠️ CRITICAL: This model contains {packageResult.CloudLinksDetected} cloud-hosted link(s) (BIM 360/ACC) that CANNOT be packaged.\n\n" +
                            "These linked models (often Architecture/Structure backgrounds) will be MISSING when we open your file. " +
                            "Your shop drawings may show MEP elements floating in empty space without walls, floors, or structural grids.\n\n" +
                            "STRONGLY RECOMMENDED:\n" +
                            "• Cancel now and use Revit's eTransmit (File > Export > eTransmit) to create a local package\n" +
                            "• Or use 'Bind Link' to embed critical backgrounds into your model\n\n" +
                            "Only continue if you are certain the cloud links are NOT needed for your shop drawings.\n\n" +
                            "Do you want to continue anyway?",
                            "Cloud Links Cannot Be Accessed",
                            MessageBoxButton.YesNo,
                            MessageBoxImage.Warning);

                        if (cloudWarningResult != MessageBoxResult.Yes)
                        {
                            userCancelled = true;
                        }
                    });

                    if (userCancelled)
                    {
                        _packagingService.CleanupAll();
                        HideProgress();
                        UploadButton.IsEnabled = true;
                        CancelButton.IsEnabled = true;
                        return;
                    }
                }

                // Phase 3: TransmissionData operations (MUST run on main thread)
                // This uses Revit API for re-pathing links - calling from background thread would crash
                _packagingService.RepathLinksOnMainThread(packageResult, (progress, message) =>
                {
                    ProgressText.Text = message;
                    ProgressBar.Value = 55 + (progress * 0.05);
                });

                // Phase 4: Final ZIP creation (run on background thread)
                packagePath = await Task.Run(() =>
                {
                    return _packagingService.FinalizePackage(packageData, (progress, message) =>
                    {
                        Dispatcher.Invoke(() =>
                        {
                            ProgressText.Text = message;
                            ProgressBar.Value = 60 + (progress * 0.05);
                        });
                    });
                });

                // At this point, packaging is complete. Start upload with dialog open.
                ProgressText.Text = "Uploading...";
                ProgressBar.Value = 65;
                
                // Enable cancel button during upload
                CancelButton.IsEnabled = true;
                _isUploading = true;
                _uploadCancellation = new System.Threading.CancellationTokenSource();
                UploadHelper.IncrementActiveUploads();

                string orderId = order.Id;
                int sheetCount = selectedSheets.Count;
                string localPackagePath = packagePath;
                // Note: Keep packagePath set so it can be cleaned up on error

                try
                {
                    // Perform upload with cancellation support
                    await PerformUploadAsync(orderId, localPackagePath, sheetCount, _uploadCancellation.Token, (progress, message) =>
                    {
                        ProgressText.Text = message;
                        ProgressBar.Value = 65 + (progress * 0.35); // 65-100%
                    });

                    // Success - cleanup and close
                    _packagingService.Cleanup(localPackagePath);
                    
                    MessageBox.Show(
                        $"Upload complete!\n\nOrder: {orderId}\nSheets: {sheetCount}\n\n" +
                        "You will be notified when your LOD 400 model is ready.",
                        "Success",
                        MessageBoxButton.OK,
                        MessageBoxImage.Information);
                    
                    Close();
                }
                catch (OperationCanceledException)
                {
                    // Upload was cancelled - don't cleanup package, can be resumed
                    MessageBox.Show(
                        "Upload cancelled.\n\nYou can resume the upload by starting a new upload.",
                        "Upload Cancelled",
                        MessageBoxButton.OK,
                        MessageBoxImage.Information);
                    
                    HideProgress();
                    UploadButton.IsEnabled = true;
                    CancelButton.IsEnabled = true;
                }
                finally
                {
                    _isUploading = false;
                    _uploadCancellation?.Dispose();
                    _uploadCancellation = null;
                    UploadHelper.DecrementActiveUploads();
                }
            }
            catch (Exception ex)
            {
                // Clean up all temporary resources (temp directory and zip file)
                // This ensures no resources are left behind regardless of which phase failed
                _packagingService.CleanupAll();

                MessageBox.Show(
                    $"Error: {ex.Message}\n\nPlease try again.",
                    "Upload Failed",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);

                HideProgress();
                ProgressBar.IsIndeterminate = false;
                UploadButton.IsEnabled = true;
                CancelButton.IsEnabled = true;
            }
        }

        /// <summary>
        /// Performs the actual file upload with progress reporting and cancellation support.
        /// </summary>
        private async Task PerformUploadAsync(string orderId, string packagePath, int sheetCount,
            System.Threading.CancellationToken cancellationToken, Action<int, string> progressCallback)
        {
            const long RESUMABLE_THRESHOLD = 50 * 1024 * 1024; // 50 MB
            
            string fileName = System.IO.Path.GetFileName(packagePath);
            long fileSize = _packagingService.GetFileSize(packagePath);

            progressCallback?.Invoke(0, "Starting upload...");
            cancellationToken.ThrowIfCancellationRequested();

            if (fileSize > RESUMABLE_THRESHOLD)
            {
                // Use resumable upload for large files
                var sessionManager = new UploadSessionManager();
                sessionManager.CleanupExpiredSessions();

                var existingSession = sessionManager.GetExistingSession(orderId, packagePath, fileSize);
                ResumableUploadSession session;

                if (existingSession != null)
                {
                    var status = await _apiService.CheckResumableUploadStatusAsync(existingSession.SessionUri);
                    if (status.IsComplete)
                    {
                        await _apiService.MarkUploadCompleteAsync(orderId, fileName, fileSize, existingSession.StorageKey);
                        sessionManager.RemoveSession(existingSession);
                        progressCallback?.Invoke(100, "Upload complete!");
                        return;
                    }
                    else if (status.BytesUploaded >= 0)
                    {
                        session = existingSession;
                        session.BytesUploaded = status.BytesUploaded;
                        sessionManager.SaveSession(session);
                        int resumePercent = fileSize > 0 ? (int)((status.BytesUploaded * 100) / fileSize) : 0;
                        progressCallback?.Invoke(resumePercent, $"Resuming from {resumePercent}%...");
                    }
                    else
                    {
                        session = await _apiService.InitiateResumableUploadAsync(orderId, fileName, fileSize);
                        session.FilePath = packagePath;
                        sessionManager.SaveSession(session);
                    }
                }
                else
                {
                    session = await _apiService.InitiateResumableUploadAsync(orderId, fileName, fileSize);
                    session.FilePath = packagePath;
                    sessionManager.SaveSession(session);
                }

                cancellationToken.ThrowIfCancellationRequested();

                await _apiService.UploadFileResumableAsync(
                    session,
                    packagePath,
                    (progress) => progressCallback?.Invoke(progress, $"Uploading... {progress}%"),
                    (updatedSession) => sessionManager.SaveSession(updatedSession),
                    cancellationToken);

                await _apiService.MarkUploadCompleteAsync(orderId, fileName, fileSize, session.StorageKey);
                sessionManager.RemoveSession(session);
            }
            else
            {
                // Use simple upload for smaller files
                string uploadUrl = await _apiService.GetUploadUrlAsync(orderId, fileName);
                cancellationToken.ThrowIfCancellationRequested();

                await _apiService.UploadFileAsync(uploadUrl, packagePath, 
                    (progress) => progressCallback?.Invoke(progress, $"Uploading... {progress}%"),
                    cancellationToken);

                await _apiService.MarkUploadCompleteAsync(orderId, fileName, fileSize, uploadUrl);
            }

            progressCallback?.Invoke(100, "Upload complete!");
        }
    }

    /// <summary>
    /// Helper class to expose upload status to App.cs for shutdown warning
    /// </summary>
    public static class UploadHelper
    {
        // Track active upload dialogs
        private static int _activeUploadCount = 0;
        
        public static void IncrementActiveUploads() => System.Threading.Interlocked.Increment(ref _activeUploadCount);
        public static void DecrementActiveUploads() => System.Threading.Interlocked.Decrement(ref _activeUploadCount);
        
        public static bool IsUploadInProgress() => _activeUploadCount > 0;
    }

    // Note: BackgroundUploader has been replaced with in-dialog upload with cancellation support.
    // Upload now happens in UploadDialog.PerformUploadAsync with proper cancellation token handling.

    public class SheetItem : INotifyPropertyChanged
    {
        private bool _isSelected;

        public ElementId ElementId { get; set; }
        public string SheetNumber { get; set; }
        public string SheetName { get; set; }
        public string Revision { get; set; }

        public bool IsSelected
        {
            get => _isSelected;
            set
            {
                _isSelected = value;
                OnPropertyChanged(nameof(IsSelected));
            }
        }

        public event PropertyChangedEventHandler PropertyChanged;

        protected void OnPropertyChanged(string propertyName)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }
    }
}
