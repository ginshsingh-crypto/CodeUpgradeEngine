using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Threading.Tasks;
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

            Loaded += StatusDialog_Loaded;
        }

        private async void StatusDialog_Loaded(object sender, RoutedEventArgs e)
        {
            await LoadOrders();
        }

        private async Task LoadOrders()
        {
            LoadingOverlay.Visibility = Visibility.Visible;
            EmptyState.Visibility = Visibility.Collapsed;

            try
            {
                if (!_apiService.HasSession)
                {
                    if (!_apiService.LoadFromConfig())
                    {
                        var loginDialog = new LoginDialog();
                        if (loginDialog.ShowDialog() != true || !loginDialog.IsAuthenticated)
                        {
                            Close();
                            return;
                        }
                        _apiService.LoadFromConfig();
                    }
                }

                var orders = await _apiService.GetOrdersAsync();
                
                _orders.Clear();
                foreach (var order in orders)
                {
                    _orders.Add(new OrderViewModel(order));
                }

                if (_orders.Count == 0)
                {
                    EmptyState.Visibility = Visibility.Visible;
                }
            }
            catch (ApiUnauthorizedException)
            {
                MessageBox.Show("Your session has expired. Please sign in again.", "Session Expired", 
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                
                var loginDialog = new LoginDialog();
                if (loginDialog.ShowDialog() == true && loginDialog.IsAuthenticated)
                {
                    _apiService.LoadFromConfig();
                    await LoadOrders();
                }
                else
                {
                    Close();
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to load orders: {ex.Message}", "Error", 
                    MessageBoxButton.OK, MessageBoxImage.Error);
            }
            finally
            {
                LoadingOverlay.Visibility = Visibility.Collapsed;
            }
        }

        private async void RefreshButton_Click(object sender, RoutedEventArgs e)
        {
            await LoadOrders();
        }

        private async void DownloadButton_Click(object sender, RoutedEventArgs e)
        {
            var button = sender as Button;
            var orderId = button?.Tag as string;

            if (string.IsNullOrEmpty(orderId)) return;

            try
            {
                button.IsEnabled = false;
                button.Content = "Getting URL...";

                var response = await _apiService.GetDownloadUrlAsync(orderId);
                
                if (!string.IsNullOrEmpty(response.DownloadURL))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = response.DownloadURL,
                        UseShellExecute = true
                    });
                }
                else
                {
                    MessageBox.Show("No download available for this order yet.", "Not Ready",
                        MessageBoxButton.OK, MessageBoxImage.Information);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to get download link: {ex.Message}", "Error", 
                    MessageBoxButton.OK, MessageBoxImage.Error);
            }
            finally
            {
                button.IsEnabled = true;
                button.Content = "Download";
            }
        }

        private void CloseButton_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }
    }

    public class OrderViewModel
    {
        private readonly Order _order;

        public OrderViewModel(Order order)
        {
            _order = order;
        }

        public string Id => _order.Id;
        public string DisplayId => _order.Id.Length > 8 ? _order.Id.Substring(0, 8) + "..." : _order.Id;
        public int SheetCount => _order.SheetCount;
        public int TotalPriceSar => _order.TotalPriceSar;
        public string Status => _order.Status;
        public string StatusDisplay => string.IsNullOrEmpty(_order.Status) ? "Unknown" 
            : char.ToUpper(_order.Status[0]) + _order.Status.Substring(1);
        public bool CanDownload => _order.Status == "complete";
        public string FormattedDate => _order.CreatedAt?.ToString("MMM dd, yyyy") ?? "-";

        public Brush StatusColor
        {
            get
            {
                switch (_order.Status?.ToLower())
                {
                    case "pending": return new SolidColorBrush(Color.FromRgb(254, 243, 199));
                    case "paid": return new SolidColorBrush(Color.FromRgb(219, 234, 254));
                    case "uploaded": return new SolidColorBrush(Color.FromRgb(243, 232, 255));
                    case "processing": return new SolidColorBrush(Color.FromRgb(255, 237, 213));
                    case "complete": return new SolidColorBrush(Color.FromRgb(220, 252, 231));
                    default: return new SolidColorBrush(Color.FromRgb(229, 231, 235));
                }
            }
        }

        public Brush StatusForeground
        {
            get
            {
                switch (_order.Status?.ToLower())
                {
                    case "pending": return new SolidColorBrush(Color.FromRgb(146, 64, 14));
                    case "paid": return new SolidColorBrush(Color.FromRgb(30, 64, 175));
                    case "uploaded": return new SolidColorBrush(Color.FromRgb(107, 33, 168));
                    case "processing": return new SolidColorBrush(Color.FromRgb(154, 52, 18));
                    case "complete": return new SolidColorBrush(Color.FromRgb(22, 101, 52));
                    default: return new SolidColorBrush(Color.FromRgb(55, 65, 81));
                }
            }
        }
    }
}
