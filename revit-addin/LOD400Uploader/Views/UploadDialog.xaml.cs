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
            // Close the dialog (during sheet selection phase)
            // Note: Background uploads continue after dialog closes and can be cancelled
            // by attempting to start a new upload (which offers to cancel the existing one)
            Close();
        }
        
        protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
        {
            base.OnClosing(e);
            
            // If we're closing after intentionally starting a background upload, don't prompt
            // The upload will continue in the background and can be cancelled by starting a new upload
            if (_closingAfterUploadStarted)
            {
                return;
            }
            
            // No need to check IsUploading here - if user closes during sheet selection,
            // there's no upload to cancel. If there's a background upload from a previous
            // dialog instance, that's handled by StartUpload when user tries again.
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

                // At this point, packaging is complete. Close the dialog and upload in background.
                ProgressText.Text = "Starting background upload...";
                ProgressBar.Value = 65;

                // Store values needed for background upload
                string orderId = order.Id;
                int sheetCount = selectedSheets.Count;
                string localPackagePath = packagePath;
                packagePath = null; // Don't cleanup on dialog close

                // Start background upload
                BackgroundUploader.StartUpload(_apiService, _packagingService, orderId, localPackagePath, sheetCount);

                // Mark that we're closing intentionally after starting upload (don't prompt in OnClosing)
                _closingAfterUploadStarted = true;
                Close();
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
    }

    /// <summary>
    /// Helper class to expose upload status to App.cs for shutdown warning
    /// </summary>
    public static class UploadHelper
    {
        public static bool IsUploadInProgress() => BackgroundUploader.IsUploading;
    }

    public static class BackgroundUploader
    {
        private static bool _isUploading = false;
        private static System.Threading.CancellationTokenSource _cancellationTokenSource;
        private const long RESUMABLE_THRESHOLD = 50 * 1024 * 1024; // 50 MB - use resumable uploads for files larger than this
        
        /// <summary>
        /// Returns true if an upload is currently in progress
        /// </summary>
        public static bool IsUploading => _isUploading;

        /// <summary>
        /// Cancels the current upload if one is in progress.
        /// The package file is preserved so the upload can be resumed later.
        /// </summary>
        public static void CancelUpload()
        {
            if (_isUploading && _cancellationTokenSource != null)
            {
                _cancellationTokenSource.Cancel();
            }
        }

        public static void StartUpload(ApiService apiService, PackagingService packagingService, 
            string orderId, string packagePath, int sheetCount)
        {
            if (_isUploading)
            {
                // Offer to cancel the existing upload instead of just showing an error
                var result = MessageBox.Show(
                    "Another upload is already in progress.\n\n" +
                    "Would you like to cancel it and start a new upload?",
                    "Upload In Progress",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Question);
                
                if (result == MessageBoxResult.Yes)
                {
                    CancelUpload();
                    // Note: The cancelled upload will set _isUploading = false when it completes
                    // User can try again after a moment
                    MessageBox.Show(
                        "Upload cancelled. Please wait a moment, then try again.",
                        "Upload Cancelled",
                        MessageBoxButton.OK,
                        MessageBoxImage.Information);
                }
                return;
            }

            _isUploading = true;
            _cancellationTokenSource = new System.Threading.CancellationTokenSource();
            var cancellationToken = _cancellationTokenSource.Token;

            Task.Run(async () =>
            {
                try
                {
                    string fileName = System.IO.Path.GetFileName(packagePath);
                    long fileSize = packagingService.GetFileSize(packagePath);

                    if (fileSize > RESUMABLE_THRESHOLD)
                    {
                        // Use resumable upload for large files
                        await UploadResumableAsync(apiService, packagingService, orderId, packagePath, fileName, fileSize, sheetCount, cancellationToken);
                    }
                    else
                    {
                        // Use simple upload for smaller files
                        await UploadSimpleAsync(apiService, packagingService, orderId, packagePath, fileName, fileSize, sheetCount, cancellationToken);
                    }
                }
                catch (OperationCanceledException)
                {
                    // Upload was cancelled - don't cleanup package, it can be resumed
                    System.Windows.Application.Current?.Dispatcher?.Invoke(() =>
                    {
                        MessageBox.Show(
                            "Upload cancelled.\n\nThe upload can be resumed by starting a new upload for the same order.",
                            "Upload Cancelled",
                            MessageBoxButton.OK,
                            MessageBoxImage.Information);
                    });
                }
                catch (Exception ex)
                {
                    packagingService.Cleanup(packagePath);

                    System.Windows.Application.Current?.Dispatcher?.Invoke(() =>
                    {
                        MessageBox.Show(
                            $"Upload failed: {ex.Message}\n\nPlease try again.",
                            "Upload Failed",
                            MessageBoxButton.OK,
                            MessageBoxImage.Error);
                    });
                }
                finally
                {
                    _isUploading = false;
                    _cancellationTokenSource?.Dispose();
                    _cancellationTokenSource = null;
                }
            });
        }

        private static async Task UploadSimpleAsync(ApiService apiService, PackagingService packagingService,
            string orderId, string packagePath, string fileName, long fileSize, int sheetCount,
            System.Threading.CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            
            string uploadUrl = await apiService.GetUploadUrlAsync(orderId, fileName);

            cancellationToken.ThrowIfCancellationRequested();
            
            await apiService.UploadFileAsync(uploadUrl, packagePath, (progress) => { }, cancellationToken);

            cancellationToken.ThrowIfCancellationRequested();
            
            await apiService.MarkUploadCompleteAsync(orderId, fileName, fileSize, uploadUrl);

            packagingService.Cleanup(packagePath);

            System.Windows.Application.Current?.Dispatcher?.Invoke(() =>
            {
                MessageBox.Show(
                    $"Upload complete!\n\nOrder: {orderId}\nSheets: {sheetCount}\n\n" +
                    "You will be notified when your LOD 400 model is ready.",
                    "Success",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
            });
        }

        private static async Task UploadResumableAsync(ApiService apiService, PackagingService packagingService,
            string orderId, string packagePath, string fileName, long fileSize, int sheetCount,
            System.Threading.CancellationToken cancellationToken)
        {
            var sessionManager = new UploadSessionManager();
            sessionManager.CleanupExpiredSessions();

            cancellationToken.ThrowIfCancellationRequested();
            
            // Check for existing session to resume
            var existingSession = sessionManager.GetExistingSession(orderId, packagePath, fileSize);
            ResumableUploadSession session;

            if (existingSession != null)
            {
                // Check if the session is still valid on GCS
                var status = await apiService.CheckResumableUploadStatusAsync(existingSession.SessionUri);
                if (status.IsComplete)
                {
                    // Already complete, just mark it done
                    await apiService.MarkUploadCompleteAsync(orderId, fileName, fileSize, existingSession.StorageKey);
                    sessionManager.RemoveSession(existingSession);
                    packagingService.Cleanup(packagePath);

                    System.Windows.Application.Current?.Dispatcher?.Invoke(() =>
                    {
                        MessageBox.Show(
                            $"Upload complete!\n\nOrder: {orderId}\nSheets: {sheetCount}\n\n" +
                            "You will be notified when your LOD 400 model is ready.",
                            "Success",
                            MessageBoxButton.OK,
                            MessageBoxImage.Information);
                    });
                    return;
                }
                else if (status.BytesUploaded >= 0)
                {
                    // Resume from where we left off
                    session = existingSession;
                    session.BytesUploaded = status.BytesUploaded;
                    sessionManager.SaveSession(session);

                    double resumePercent = (double)status.BytesUploaded / fileSize * 100;
                    Debug.WriteLine($"Resuming upload from {resumePercent:F1}% ({status.BytesUploaded} bytes)");
                }
                else
                {
                    // Session expired, create new one
                    session = await apiService.InitiateResumableUploadAsync(orderId, fileName, fileSize);
                    session.FilePath = packagePath;
                    sessionManager.SaveSession(session);
                }
            }
            else
            {
                // Create new resumable upload session
                session = await apiService.InitiateResumableUploadAsync(orderId, fileName, fileSize);
                session.FilePath = packagePath;
                sessionManager.SaveSession(session);
            }

            cancellationToken.ThrowIfCancellationRequested();
            
            // Perform the chunked upload with progress tracking
            await apiService.UploadFileResumableAsync(
                session,
                packagePath,
                (progress) => { /* Progress callback - can be used for UI updates */ },
                (updatedSession) => 
                {
                    // Save session state after each chunk for resume capability
                    sessionManager.SaveSession(updatedSession);
                },
                cancellationToken);

            cancellationToken.ThrowIfCancellationRequested();
            
            // Mark upload complete
            await apiService.MarkUploadCompleteAsync(orderId, fileName, fileSize, session.StorageKey);

            // Cleanup
            sessionManager.RemoveSession(session);
            packagingService.Cleanup(packagePath);

            System.Windows.Application.Current?.Dispatcher?.Invoke(() =>
            {
                MessageBox.Show(
                    $"Upload complete!\n\nOrder: {orderId}\nSheets: {sheetCount}\n\n" +
                    "You will be notified when your LOD 400 model is ready.",
                    "Success",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
            });
        }
    }

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
