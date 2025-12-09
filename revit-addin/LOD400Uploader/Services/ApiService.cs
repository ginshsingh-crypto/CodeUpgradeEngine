using System;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using LOD400Uploader.Models;
using System.Collections.Generic;
using System.Net.Http.Headers;

namespace LOD400Uploader.Services
{
    public class LoginResult
    {
        public bool Success { get; set; }
        public string Token { get; set; }
        public string ErrorMessage { get; set; }
    }

    public class ApiService
    {
        private readonly HttpClient _httpClient;
        private readonly string _baseUrl;
        private string _sessionToken;
        
        private static readonly string ConfigPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "LOD400Uploader",
            "config.json"
        );

        public ApiService()
        {
            _httpClient = new HttpClient();
            _httpClient.Timeout = TimeSpan.FromMinutes(10);
            _baseUrl = App.ApiBaseUrl;
        }
        
        public bool LoadFromConfig()
        {
            try
            {
                if (File.Exists(ConfigPath))
                {
                    var json = File.ReadAllText(ConfigPath);
                    var config = JsonConvert.DeserializeObject<dynamic>(json);
                    
                    string sessionToken = config?.sessionToken;
                    if (!string.IsNullOrEmpty(sessionToken))
                    {
                        SetSessionToken(sessionToken);
                        return true;
                    }
                }
            }
            catch
            {
            }
            return false;
        }

        public void SetSessionToken(string token)
        {
            _sessionToken = token;
            _httpClient.DefaultRequestHeaders.Clear();
            _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        public bool HasSession => !string.IsNullOrEmpty(_sessionToken);

        public async Task<LoginResult> LoginAsync(string email, string password)
        {
            try
            {
                using (var client = new HttpClient())
                {
                    var loginRequest = new { email = email, password = password, deviceLabel = "Revit Add-in" };
                    var json = JsonConvert.SerializeObject(loginRequest);
                    var content = new StringContent(json, Encoding.UTF8, "application/json");

                    var response = await client.PostAsync($"{_baseUrl}/api/auth/login", content);
                    var responseJson = await response.Content.ReadAsStringAsync();

                    if (response.IsSuccessStatusCode)
                    {
                        var result = JsonConvert.DeserializeObject<dynamic>(responseJson);
                        return new LoginResult
                        {
                            Success = true,
                            Token = result.token
                        };
                    }
                    else
                    {
                        var error = JsonConvert.DeserializeObject<dynamic>(responseJson);
                        return new LoginResult
                        {
                            Success = false,
                            ErrorMessage = error?.message ?? "Login failed"
                        };
                    }
                }
            }
            catch (Exception ex)
            {
                return new LoginResult
                {
                    Success = false,
                    ErrorMessage = ex.Message
                };
            }
        }

        public async Task<bool> ValidateSessionAsync(string token)
        {
            try
            {
                using (var client = new HttpClient())
                {
                    client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    var response = await client.GetAsync($"{_baseUrl}/api/auth/validate");
                    return response.IsSuccessStatusCode;
                }
            }
            catch
            {
                return false;
            }
        }

        public async Task<CreateOrderResponse> CreateOrderAsync(int sheetCount)
        {
            EnsureSession();
            var request = new CreateOrderRequest { SheetCount = sheetCount };
            var json = JsonConvert.SerializeObject(request);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _httpClient.PostAsync($"{_baseUrl}/api/addin/create-order", content);
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<CreateOrderResponse>(responseJson);
        }

        public async Task<Order> PollOrderStatusAsync(string orderId, int maxAttempts = 60, int delayMs = 2000)
        {
            EnsureSession();
            for (int i = 0; i < maxAttempts; i++)
            {
                var order = await GetOrderStatusAsync(orderId);
                if (order.Status == "paid" || order.Status == "uploaded" || 
                    order.Status == "processing" || order.Status == "complete")
                {
                    return order;
                }
                await Task.Delay(delayMs);
            }
            throw new TimeoutException("Payment verification timed out. Please check your order status manually.");
        }

        public async Task<string> GetUploadUrlAsync(string orderId, string fileName)
        {
            EnsureSession();
            var request = new { fileName = fileName };
            var json = JsonConvert.SerializeObject(request);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _httpClient.PostAsync($"{_baseUrl}/api/addin/orders/{orderId}/upload-url", content);
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            var result = JsonConvert.DeserializeObject<UploadUrlResponse>(responseJson);
            return result.UploadURL;
        }

        public async Task MarkUploadCompleteAsync(string orderId, string fileName, long fileSize, string uploadUrl)
        {
            EnsureSession();
            var request = new UploadCompleteRequest
            {
                FileName = fileName,
                FileSize = fileSize,
                UploadURL = uploadUrl
            };
            var json = JsonConvert.SerializeObject(request);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _httpClient.PostAsync($"{_baseUrl}/api/addin/orders/{orderId}/upload-complete", content);
            response.EnsureSuccessStatusCode();
        }

        public async Task<Order> GetOrderStatusAsync(string orderId)
        {
            EnsureSession();
            var response = await _httpClient.GetAsync($"{_baseUrl}/api/addin/orders/{orderId}/status");
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<Order>(responseJson);
        }

        public async Task<List<Order>> GetOrdersAsync()
        {
            EnsureSession();
            var response = await _httpClient.GetAsync($"{_baseUrl}/api/addin/orders");
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<List<Order>>(responseJson);
        }

        public async Task<DownloadUrlResponse> GetDownloadUrlAsync(string orderId)
        {
            EnsureSession();
            var response = await _httpClient.GetAsync($"{_baseUrl}/api/addin/orders/{orderId}/download-url");
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<DownloadUrlResponse>(responseJson);
        }

        public async Task UploadFileAsync(string uploadUrl, string filePath, Action<int> progressCallback)
        {
            using (var client = new HttpClient())
            {
                client.Timeout = TimeSpan.FromHours(2);

                progressCallback?.Invoke(0);

                // Stream the file directly from disk to avoid loading entire file into RAM
                // This prevents OutOfMemoryException on large files (500MB-2GB)
                using (var fileStream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize: 81920))
                {
                    using (var content = new StreamContent(fileStream, bufferSize: 81920))
                    {
                        content.Headers.ContentType = new MediaTypeHeaderValue("application/zip");
                        var response = await client.PutAsync(uploadUrl, content);
                        response.EnsureSuccessStatusCode();
                    }
                }

                progressCallback?.Invoke(100);
            }
        }

        private void EnsureSession()
        {
            if (!HasSession)
            {
                throw new InvalidOperationException("Session not active. Please sign in first.");
            }
        }
    }
}
