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

        public async Task<CreateOrderResponse> CreateOrderAsync(int sheetCount, List<SheetInfo> sheets = null)
        {
            EnsureSession();
            var request = new CreateOrderRequest { SheetCount = sheetCount, Sheets = sheets ?? new List<SheetInfo>() };
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

                // Get file size for progress calculation
                var fileInfo = new FileInfo(filePath);
                long totalBytes = fileInfo.Length;

                // Stream the file directly from disk with progress reporting
                using (var fileStream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize: 81920))
                {
                    // Wrap in ProgressStream to track bytes read
                    using (var progressStream = new ProgressStream(fileStream, totalBytes, (percent) =>
                    {
                        progressCallback?.Invoke(percent);
                    }))
                    {
                        using (var content = new StreamContent(progressStream, bufferSize: 81920))
                        {
                            content.Headers.ContentType = new MediaTypeHeaderValue("application/zip");
                            content.Headers.ContentLength = totalBytes;
                            
                            var response = await client.PutAsync(uploadUrl, content);
                            response.EnsureSuccessStatusCode();
                        }
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

    /// <summary>
    /// Stream wrapper that reports progress as bytes are read
    /// This solves the "frozen progress bar" issue where HttpClient.PutAsync
    /// doesn't report upload progress by default
    /// </summary>
    public class ProgressStream : Stream
    {
        private readonly Stream _innerStream;
        private readonly long _totalBytes;
        private readonly Action<int> _progressCallback;
        private long _bytesRead;
        private int _lastReportedPercent;

        public ProgressStream(Stream innerStream, long totalBytes, Action<int> progressCallback)
        {
            _innerStream = innerStream;
            _totalBytes = totalBytes;
            _progressCallback = progressCallback;
            _bytesRead = 0;
            _lastReportedPercent = 0;
        }

        public override bool CanRead => _innerStream.CanRead;
        public override bool CanSeek => _innerStream.CanSeek;
        public override bool CanWrite => false;
        public override long Length => _innerStream.Length;
        public override long Position
        {
            get => _innerStream.Position;
            set => _innerStream.Position = value;
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            int bytesRead = _innerStream.Read(buffer, offset, count);
            _bytesRead += bytesRead;
            ReportProgress();
            return bytesRead;
        }

        public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, System.Threading.CancellationToken cancellationToken)
        {
            int bytesRead = await _innerStream.ReadAsync(buffer, offset, count, cancellationToken);
            _bytesRead += bytesRead;
            ReportProgress();
            return bytesRead;
        }

        private void ReportProgress()
        {
            if (_totalBytes <= 0) return;
            int percent = (int)((_bytesRead * 100) / _totalBytes);
            
            // Only report when progress changes by at least 1%
            if (percent > _lastReportedPercent)
            {
                _lastReportedPercent = percent;
                _progressCallback?.Invoke(percent);
            }
        }

        public override void Flush() => _innerStream.Flush();
        public override long Seek(long offset, SeekOrigin origin) => _innerStream.Seek(offset, origin);
        public override void SetLength(long value) => _innerStream.SetLength(value);
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            // Don't dispose inner stream - caller owns it
            base.Dispose(disposing);
        }
    }
}
