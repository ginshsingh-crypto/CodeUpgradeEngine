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
        private const int PRICE_PER_SHEET = 150;

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
            int totalPrice = selectedCount * PRICE_PER_SHEET;

            SelectedCountText.Text = $"{selectedCount} sheets selected";
            SheetCountRun.Text = selectedCount.ToString();
            TotalPriceRun.Text = totalPrice.ToString("N0");

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
                var loginDialog = new LoginDialog();
                if (loginDialog.ShowDialog() != true || !loginDialog.IsAuthenticated)
                {
                    return;
                }
            }

            UploadButton.IsEnabled = false;
            ProgressPanel.Visibility = System.Windows.Visibility.Visible;

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
                        "Please complete the payment. The upload will begin automatically once payment is confirmed.\n\n" +
                        "Do not close this window.",
                        "Complete Payment",
                        MessageBoxButton.OK,
                        MessageBoxImage.Information);

                    ProgressText.Text = "Waiting for payment confirmation...";
                    ProgressBar.Value = 15;
                    ProgressBar.IsIndeterminate = true;

                    try
                    {
                        order = await _apiService.PollOrderStatusAsync(order.Id, maxAttempts: 90, delayMs: 2000);
                        ProgressBar.IsIndeterminate = false;
                    }
                    catch (TimeoutException)
                    {
                        ProgressBar.IsIndeterminate = false;
                        var result = MessageBox.Show(
                            "Payment confirmation is taking longer than expected.\n\n" +
                            "Would you like to continue waiting?",
                            "Payment Pending",
                            MessageBoxButton.YesNo,
                            MessageBoxImage.Question);

                        if (result == MessageBoxResult.Yes)
                        {
                            ProgressBar.IsIndeterminate = true;
                            order = await _apiService.PollOrderStatusAsync(order.Id, maxAttempts: 180, delayMs: 2000);
                            ProgressBar.IsIndeterminate = false;
                        }
                        else
                        {
                            ProgressPanel.Visibility = System.Windows.Visibility.Collapsed;
                            UploadButton.IsEnabled = true;
                            MessageBox.Show(
                                $"Order {order.Id} has been created but not paid.\n\n" +
                                "You can complete payment later and upload your model using the 'Check Status' command.",
                                "Order Pending",
                                MessageBoxButton.OK,
                                MessageBoxImage.Information);
                            return;
                        }
                    }
                }

                if (order.Status != "paid" && order.Status != "uploaded" && 
                    order.Status != "processing" && order.Status != "complete")
                {
                    throw new InvalidOperationException($"Order status is '{order.Status}'. Expected 'paid' or later status.");
                }

                ProgressText.Text = "Packaging model...";
                ProgressBar.Value = 20;

                var selectedIds = selectedSheets.Select(s => s.ElementId).ToList();
                
                await Task.Run(() =>
                {
                    packagePath = _packagingService.PackageModel(_document, selectedIds, (progress, message) =>
                    {
                        Dispatcher.Invoke(() =>
                        {
                            ProgressText.Text = message;
                            ProgressBar.Value = 20 + (progress * 0.4);
                        });
                    });
                });

                ProgressText.Text = "Preparing upload...";
                ProgressBar.Value = 65;

                string fileName = System.IO.Path.GetFileName(packagePath);
                string uploadUrl = await _apiService.GetUploadUrlAsync(order.Id, fileName);

                ProgressText.Text = "Uploading model...";
                ProgressBar.Value = 70;

                long fileSize = _packagingService.GetFileSize(packagePath);
                byte[] fileData = await Task.Run(() => _packagingService.ReadFileBytes(packagePath));

                await _apiService.UploadFileAsync(uploadUrl, fileData, (progress) =>
                {
                    Dispatcher.Invoke(() =>
                    {
                        ProgressBar.Value = 70 + (progress * 0.25);
                    });
                });

                ProgressText.Text = "Finalizing...";
                ProgressBar.Value = 95;

                await _apiService.MarkUploadCompleteAsync(order.Id, fileName, fileSize, uploadUrl);

                _packagingService.Cleanup(packagePath);
                packagePath = null;

                ProgressBar.Value = 100;
                ProgressText.Text = "Upload complete!";

                MessageBox.Show(
                    $"Your model has been uploaded successfully!\n\n" +
                    $"Order ID: {order.Id}\n" +
                    $"Sheets: {selectedSheets.Count}\n" +
                    $"Total: {order.TotalPriceSar} SAR\n\n" +
                    "You will be notified when your LOD 400 deliverables are ready.",
                    "Upload Complete",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);

                Close();
            }
            catch (Exception ex)
            {
                if (!string.IsNullOrEmpty(packagePath))
                {
                    _packagingService.Cleanup(packagePath);
                }

                MessageBox.Show(
                    $"An error occurred during the upload process:\n\n{ex.Message}\n\n" +
                    "Please try again or contact support if the issue persists.",
                    "Upload Error",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);

                ProgressPanel.Visibility = System.Windows.Visibility.Collapsed;
                ProgressBar.IsIndeterminate = false;
                UploadButton.IsEnabled = true;
            }
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
