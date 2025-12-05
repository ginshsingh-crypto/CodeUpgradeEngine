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
        private bool _usedLegacyApiKey = false;

        public LoginDialog()
        {
            InitializeComponent();
            _apiService = new ApiService();
            
            Loaded += async (s, e) => await LoadSavedCredentialsAsync();
        }

        private async System.Threading.Tasks.Task LoadSavedCredentialsAsync()
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

                    string savedApiKey = config?.apiKey;
                    if (!string.IsNullOrEmpty(savedApiKey))
                    {
                        await TryLegacyApiKeyLogin(savedApiKey, savedEmail);
                    }
                }
            }
            catch
            {
            }
        }

        private async System.Threading.Tasks.Task TryLegacyApiKeyLogin(string apiKey, string email)
        {
            LoginButton.IsEnabled = false;
            LoginButton.Content = "Validating API key...";
            ErrorText.Text = "Found saved API key, validating...";
            ErrorText.Visibility = Visibility.Visible;

            try
            {
                var result = await _apiService.ValidateApiKeyAsync(apiKey);
                
                if (result.Success)
                {
                    _apiService.ConfigureForLegacyApiKey(apiKey);
                    
                    SaveLegacyApiKey(apiKey, email);
                    
                    _usedLegacyApiKey = true;
                    IsAuthenticated = true;
                    
                    MessageBox.Show(
                        "Signed in using your saved API key.\n\n" +
                        "Note: API keys are being phased out. We recommend upgrading to password-based login " +
                        "in the Settings page at " + App.ApiBaseUrl + " for improved security.",
                        "Signed In (Legacy API Key)",
                        MessageBoxButton.OK,
                        MessageBoxImage.Information
                    );
                    
                    DialogResult = true;
                    Close();
                    return;
                }
                else
                {
                    ErrorText.Text = "Saved API key is invalid or expired. Please sign in with your password.";
                    ErrorText.Visibility = Visibility.Visible;
                }
            }
            catch
            {
                ErrorText.Text = "Could not validate API key. Please sign in with your password.";
                ErrorText.Visibility = Visibility.Visible;
            }
            finally
            {
                LoginButton.IsEnabled = true;
                LoginButton.Content = "Sign In";
            }
        }

        private void SaveLegacyApiKey(string apiKey, string email)
        {
            try
            {
                var dir = Path.GetDirectoryName(ConfigPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                var config = new { apiKey = apiKey, email = email };
                var json = Newtonsoft.Json.JsonConvert.SerializeObject(config);
                File.WriteAllText(ConfigPath, json);
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

                var config = new { sessionToken = sessionToken, email = email, apiKey = (string)null };
                var json = Newtonsoft.Json.JsonConvert.SerializeObject(config);
                File.WriteAllText(ConfigPath, json);
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
                // Direct to main site - users sign in with Replit Auth, then set add-in password in Settings
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
                // Direct to Settings page where users can reset their add-in password after signing in
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
