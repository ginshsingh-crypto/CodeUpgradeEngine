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

        public StatusDialog()
        {
            InitializeComponent();
            _apiService = new ApiService();
            _orders = new ObservableCollection<OrderViewModel>();
            OrdersListView.ItemsSource = _orders;

            Loaded += async (s, e) => await LoadOrdersAsync();
        }

        private async System.Threading.Tasks.Task LoadOrdersAsync()
        {
            try
            {
                LoadingPanel.Visibility = Visibility.Visible;
                EmptyPanel.Visibility = Visibility.Collapsed;
                OrdersListView.Visibility = Visibility.Collapsed;

                var orders = await _apiService.GetOrdersAsync();
                
                _orders.Clear();
                foreach (var order in orders.OrderByDescending(o => o.CreatedAt))
                {
                    _orders.Add(new OrderViewModel(order));
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
                SelectedOrderText.Text = $"Order: {selectedOrder.Id.Substring(0, 8)}... | Status: {selectedOrder.StatusDisplay}";
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
            if (selectedOrder == null || selectedOrder.Status != "complete")
            {
                MessageBox.Show("Please select a completed order to download.", "No Order Selected",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            try
            {
                DownloadButton.IsEnabled = false;
                DownloadButton.Content = "Downloading...";

                var downloadInfo = await _apiService.GetDownloadUrlAsync(selectedOrder.Id);

                // Open download in browser
                Process.Start(new ProcessStartInfo
                {
                    FileName = downloadInfo.DownloadURL,
                    UseShellExecute = true
                });

                MessageBox.Show(
                    $"Download started for: {downloadInfo.FileName}\n\n" +
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
                DownloadButton.IsEnabled = true;
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
            _ => Status
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
            Id = order.Id;
            SheetCount = order.SheetCount;
            TotalPriceSar = order.TotalPriceSar;
            Status = order.Status;
            CreatedAt = order.CreatedAt;
        }
    }
}
