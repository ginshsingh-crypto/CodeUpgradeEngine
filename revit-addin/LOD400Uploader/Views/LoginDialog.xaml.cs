using System;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using LOD400Uploader.Services;

namespace LOD400Uploader.Views
{
    public partial class LoginDialog : Window
    {
        private readonly ApiService _apiService;
        private static readonly string ConfigPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "LOD400Uploader",
            "config.json"
        );

        public bool IsAuthenticated { get; private set; }
        public ApiService AuthenticatedApiService => _apiService;

        public LoginDialog()
        {
            InitializeComponent();
            _apiService = new ApiService();
            
            UrlText.Text = $"{App.ApiBaseUrl}/settings";
            
            LoadSavedApiKey();
        }

        private void LoadSavedApiKey()
        {
            try
            {
                if (File.Exists(ConfigPath))
                {
                    var json = File.ReadAllText(ConfigPath);
                    var config = Newtonsoft.Json.JsonConvert.DeserializeObject<dynamic>(json);
                    string savedKey = config?.apiKey;
                    if (!string.IsNullOrEmpty(savedKey))
                    {
                        ApiKeyTextBox.Text = savedKey;
                    }
                }
            }
            catch
            {
            }
        }

        private void SaveApiKey(string apiKey)
        {
            try
            {
                var dir = Path.GetDirectoryName(ConfigPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                var config = new { apiKey = apiKey };
                var json = Newtonsoft.Json.JsonConvert.SerializeObject(config);
                File.WriteAllText(ConfigPath, json);
            }
            catch
            {
            }
        }

        private async void LoginButton_Click(object sender, RoutedEventArgs e)
        {
            var apiKey = ApiKeyTextBox.Text?.Trim();
            
            if (string.IsNullOrEmpty(apiKey))
            {
                ShowError("Please enter your API key.");
                return;
            }

            LoginButton.IsEnabled = false;
            LoginButton.Content = "Connecting...";
            ErrorText.Visibility = Visibility.Collapsed;

            try
            {
                bool isValid = await _apiService.ValidateApiKeyAsync(apiKey);
                
                if (isValid)
                {
                    _apiService.SetApiKey(apiKey);
                    SaveApiKey(apiKey);
                    IsAuthenticated = true;
                    DialogResult = true;
                    Close();
                }
                else
                {
                    ShowError("Invalid API key. Please check and try again.");
                }
            }
            catch (Exception ex)
            {
                ShowError($"Connection failed: {ex.Message}");
            }
            finally
            {
                LoginButton.IsEnabled = true;
                LoginButton.Content = "Connect";
            }
        }

        private void ShowError(string message)
        {
            ErrorText.Text = message;
            ErrorText.Visibility = Visibility.Visible;
        }

        private void CancelButton_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
            Close();
        }

        private void UrlText_MouseDown(object sender, MouseButtonEventArgs e)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = UrlText.Text,
                    UseShellExecute = true
                });
            }
            catch
            {
            }
        }
    }
}
