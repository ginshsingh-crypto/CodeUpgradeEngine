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
            
            Loaded += (s, e) => LoadSavedEmail();
        }

        private void LoadSavedEmail()
        {
            try
            {
                if (File.Exists(ConfigPath))
                {
                    var json = File.ReadAllText(ConfigPath);
                    var config = Newtonsoft.Json.JsonConvert.DeserializeObject<dynamic>(json);
                    
                    string savedEmail = config?.email;
                    if (!string.IsNullOrEmpty(savedEmail))
                    {
                        EmailTextBox.Text = savedEmail;
                    }
                }
            }
            catch
            {
            }
        }

        private void SaveSession(string sessionToken, string email)
        {
            try
            {
                var dir = Path.GetDirectoryName(ConfigPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                // Load existing config to preserve other values (like apiUrl)
                Newtonsoft.Json.Linq.JObject config;
                if (File.Exists(ConfigPath))
                {
                    try
                    {
                        var existingJson = File.ReadAllText(ConfigPath);
                        config = Newtonsoft.Json.Linq.JObject.Parse(existingJson);
                    }
                    catch
                    {
                        config = new Newtonsoft.Json.Linq.JObject();
                    }
                }
                else
                {
                    config = new Newtonsoft.Json.Linq.JObject();
                }

                // Update session and email, preserving other fields
                config["sessionToken"] = sessionToken;
                config["email"] = email;
                
                File.WriteAllText(ConfigPath, config.ToString());
            }
            catch
            {
            }
        }

        private async void LoginButton_Click(object sender, RoutedEventArgs e)
        {
            var email = EmailTextBox.Text?.Trim();
            var password = PasswordBox.Password;
            
            if (string.IsNullOrEmpty(email))
            {
                ShowError("Please enter your email address.");
                return;
            }

            if (string.IsNullOrEmpty(password))
            {
                ShowError("Please enter your password.");
                return;
            }

            LoginButton.IsEnabled = false;
            LoginButton.Content = "Signing in...";
            ErrorText.Visibility = System.Windows.Visibility.Collapsed;

            try
            {
                var loginResult = await _apiService.LoginAsync(email, password);
                
                if (loginResult.Success)
                {
                    _apiService.SetSessionToken(loginResult.Token);
                    SaveSession(loginResult.Token, email);
                    IsAuthenticated = true;
                    DialogResult = true;
                    Close();
                }
                else
                {
                    ShowError(loginResult.ErrorMessage ?? "Invalid email or password. Please try again.");
                }
            }
            catch (Exception ex)
            {
                ShowError($"Connection failed: {ex.Message}");
            }
            finally
            {
                LoginButton.IsEnabled = true;
                LoginButton.Content = "Sign In";
            }
        }

        private void ShowError(string message)
        {
            ErrorText.Text = message;
            ErrorText.Visibility = System.Windows.Visibility.Visible;
        }

        private void CancelButton_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
            Close();
        }

        private void SignUpLink_MouseDown(object sender, MouseButtonEventArgs e)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = App.ApiBaseUrl,
                    UseShellExecute = true
                });
            }
            catch
            {
            }
        }

        private void ForgotPasswordLink_MouseDown(object sender, MouseButtonEventArgs e)
        {
            try
            {
                MessageBox.Show(
                    "To reset your add-in password:\n\n" +
                    "1. Go to " + App.ApiBaseUrl + "\n" +
                    "2. Sign in with your account\n" +
                    "3. Go to Settings\n" +
                    "4. Set a new password in the 'Add-in Login' section\n\n" +
                    "The website will now open in your browser.",
                    "Reset Add-in Password",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
                    
                Process.Start(new ProcessStartInfo
                {
                    FileName = $"{App.ApiBaseUrl}/settings",
                    UseShellExecute = true
                });
            }
            catch
            {
            }
        }
    }
}
