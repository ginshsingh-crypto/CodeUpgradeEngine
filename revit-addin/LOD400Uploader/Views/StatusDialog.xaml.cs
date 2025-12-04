using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using LOD400Uploader.Models;
using LOD400Uploader.Services;

namespace LOD400Uploader.Views
{
    public partial class StatusDialog : Window
    {
        private readonly ApiService _apiService;
        private readonly ObservableCollection<OrderViewModel> _orders;
        private bool _isAuthenticated;

        public StatusDialog() : this(null) { }

        public StatusDialog(ApiService apiService)
        {
            InitializeComponent();
            _apiService = apiService ?? new ApiService();
            _orders = new ObservableCollection<OrderViewModel>();
            OrdersListView.ItemsSource = _orders;

            Loaded += async (s, e) => await InitializeAsync();
        }

        private async System.Threading.Tasks.Task InitializeAsync()
        {
            if (!_apiService.HasSession)
            {
                var loginDialog = new LoginDialog();
                if (loginDialog.ShowDialog() != true || !loginDialog.IsAuthenticated)
                {
                    Close();
                    return;
                }
                _isAuthenticated = true;
            }
            else
            {
                _isAuthenticated = true;
            }

            await LoadOrdersAsync();
        }

        private async System.Threading.Tasks.Task LoadOrdersAsync()
        {
            if (!_isAuthenticated) return;

            try
            {
                LoadingPanel.Visibility = Visibility.Visible;
                EmptyPanel.Visibility = Visibility.Collapsed;
                OrdersListView.Visibility = Visibility.Collapsed;

                var orders = await _apiService.GetOrdersAsync();
                
                _orders.Clear();
                
                if (orders != null)
                {
                    foreach (var order in orders.OrderByDescending(o => o.CreatedAt ?? DateTime.MinValue))
                    {
                        _orders.Add(new OrderViewModel(order));
                    }
                }

                LoadingPanel.Visibility = Visibility.Collapsed;

                if (_orders.Count == 0)
                {
                    EmptyPanel.Visibility = Visibility.Visible;
                }
                else
                {
                    OrdersListView.Visibility = Visibility.Visible;
                }
            }
            catch (Exception ex)
            {
                LoadingPanel.Visibility = Visibility.Collapsed;
                EmptyPanel.Visibility = Visibility.Visible;
                
                MessageBox.Show(
                    $"Failed to load orders:\n\n{ex.Message}\n\n" +
                    "Please check your connection and try again.",
                    "Error",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
            }
        }

        private async void RefreshButton_Click(object sender, RoutedEventArgs e)
        {
            await LoadOrdersAsync();
        }

        private void OrdersListView_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            var selectedOrder = OrdersListView.SelectedItem as OrderViewModel;
            
            if (selectedOrder != null)
            {
                string shortId = selectedOrder.Id?.Length > 8 
                    ? selectedOrder.Id.Substring(0, 8) + "..." 
                    : selectedOrder.Id ?? "";
                    
                SelectedOrderText.Text = $"Order: {shortId} | Status: {selectedOrder.StatusDisplay}";
                DownloadButton.IsEnabled = selectedOrder.Status == "complete";
            }
            else
            {
                SelectedOrderText.Text = "Select an order to view details";
                DownloadButton.IsEnabled = false;
            }
        }

        private async void DownloadButton_Click(object sender, RoutedEventArgs e)
        {
            var selectedOrder = OrdersListView.SelectedItem as OrderViewModel;
            if (selectedOrder == null)
            {
                MessageBox.Show("Please select an order first.", "No Order Selected",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            if (selectedOrder.Status != "complete")
            {
                MessageBox.Show("This order is not yet complete. Please wait for processing to finish.", 
                    "Order Not Ready", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            try
            {
                DownloadButton.IsEnabled = false;
                DownloadButton.Content = "Downloading...";

                var downloadInfo = await _apiService.GetDownloadUrlAsync(selectedOrder.Id);

                if (downloadInfo == null || string.IsNullOrEmpty(downloadInfo.DownloadURL))
                {
                    throw new InvalidOperationException("No download URL available for this order.");
                }

                Process.Start(new ProcessStartInfo
                {
                    FileName = downloadInfo.DownloadURL,
                    UseShellExecute = true
                });

                MessageBox.Show(
                    $"Download started for: {downloadInfo.FileName ?? "deliverables"}\n\n" +
                    "The file will be saved to your default downloads folder.",
                    "Download Started",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Failed to start download:\n\n{ex.Message}",
                    "Download Error",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
            }
            finally
            {
                DownloadButton.Content = "Download Deliverables";
                DownloadButton.IsEnabled = OrdersListView.SelectedItem != null && 
                    ((OrderViewModel)OrdersListView.SelectedItem).Status == "complete";
            }
        }

        private void CloseButton_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }
    }

    public class OrderViewModel
    {
        public string Id { get; }
        public int SheetCount { get; }
        public int TotalPriceSar { get; }
        public string Status { get; }
        public DateTime? CreatedAt { get; }

        public string StatusDisplay => Status switch
        {
            "pending" => "Pending Payment",
            "paid" => "Paid",
            "uploaded" => "Uploaded",
            "processing" => "Processing",
            "complete" => "Complete",
            _ => Status ?? "Unknown"
        };

        public Brush StatusBackground => Status switch
        {
            "pending" => new SolidColorBrush(Color.FromRgb(254, 243, 199)),
            "paid" => new SolidColorBrush(Color.FromRgb(219, 234, 254)),
            "uploaded" => new SolidColorBrush(Color.FromRgb(219, 234, 254)),
            "processing" => new SolidColorBrush(Color.FromRgb(233, 213, 255)),
            "complete" => new SolidColorBrush(Color.FromRgb(209, 250, 229)),
            _ => new SolidColorBrush(Color.FromRgb(229, 231, 235))
        };

        public Brush StatusForeground => Status switch
        {
            "pending" => new SolidColorBrush(Color.FromRgb(146, 64, 14)),
            "paid" => new SolidColorBrush(Color.FromRgb(30, 64, 175)),
            "uploaded" => new SolidColorBrush(Color.FromRgb(30, 64, 175)),
            "processing" => new SolidColorBrush(Color.FromRgb(107, 33, 168)),
            "complete" => new SolidColorBrush(Color.FromRgb(22, 101, 52)),
            _ => new SolidColorBrush(Color.FromRgb(75, 85, 99))
        };

        public OrderViewModel(Order order)
        {
            Id = order?.Id ?? "";
            SheetCount = order?.SheetCount ?? 0;
            TotalPriceSar = order?.TotalPriceSar ?? 0;
            Status = order?.Status ?? "";
            CreatedAt = order?.CreatedAt;
        }
    }
}
