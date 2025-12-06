using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Autodesk.Revit.DB;
using LOD400Uploader.Services;

namespace LOD400Uploader.Views
{
    public partial class UploadDialog : Window
    {
        private readonly Document _document;
        private readonly ObservableCollection<SheetItem> _sheets;
        private readonly ApiService _apiService;
        private readonly PackagingService _packagingService;

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
            Close();
        }

        private void ShowProgress()
        {
            ProgressPanel.Visibility = Visibility.Visible;
            SummaryText.Visibility = Visibility.Collapsed;
        }

        private void HideProgress()
        {
            ProgressPanel.Visibility = Visibility.Collapsed;
            SummaryText.Visibility = Visibility.Visible;
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
                ProgressText.Text = "Creating order...";
                ProgressBar.Value = 5;

                var orderResponse = await _apiService.CreateOrderAsync(selectedSheets.Count);
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
                
                // IMPORTANT: Revit API must run on the main thread - do NOT use Task.Run here
                packagePath = _packagingService.PackageModel(_document, selectedIds, (progress, message) =>
                {
                    ProgressText.Text = message;
                    ProgressBar.Value = 20 + (progress * 0.4);
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

                Close();
            }
            catch (Exception ex)
            {
                if (!string.IsNullOrEmpty(packagePath))
                {
                    _packagingService.Cleanup(packagePath);
                }

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

    public static class BackgroundUploader
    {
        private static bool _isUploading = false;

        public static void StartUpload(ApiService apiService, PackagingService packagingService, 
            string orderId, string packagePath, int sheetCount)
        {
            if (_isUploading)
            {
                MessageBox.Show("Another upload is already in progress.", "Upload In Progress",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            _isUploading = true;

            Task.Run(async () =>
            {
                try
                {
                    string fileName = System.IO.Path.GetFileName(packagePath);
                    string uploadUrl = await apiService.GetUploadUrlAsync(orderId, fileName);

                    long fileSize = packagingService.GetFileSize(packagePath);
                    byte[] fileData = packagingService.ReadFileBytes(packagePath);

                    await apiService.UploadFileAsync(uploadUrl, fileData, (progress) => { });

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
                }
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
