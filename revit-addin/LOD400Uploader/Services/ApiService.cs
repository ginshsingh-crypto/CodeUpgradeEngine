using System;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using LOD400Uploader.Models;
using System.Collections.Generic;
using System.Net.Http.Headers;

namespace LOD400Uploader.Services
{
    /// <summary>
    /// Exception thrown when the API returns 401 Unauthorized (expired/invalid token)
    /// </summary>
    public class ApiUnauthorizedException : Exception
    {
        public ApiUnauthorizedException() : base("Session expired or unauthorized") { }
        public ApiUnauthorizedException(string message) : base(message) { }
    }

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
                    var config = Newtonsoft.Json.Linq.JObject.Parse(json);
                    
                    string sessionToken = config.Value<string>("sessionToken");
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
                // Uses static _authClient to prevent socket exhaustion
                var loginRequest = new { email = email, password = password, deviceLabel = "Revit Add-in" };
                var json = JsonConvert.SerializeObject(loginRequest);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                var response = await _authClient.PostAsync($"{_baseUrl}/api/auth/login", content);
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
                // Uses static _authClient to prevent socket exhaustion
                // Note: We create a fresh request with headers to avoid header conflicts
                using (var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/auth/validate"))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    using (var response = await _authClient.SendAsync(request))
                    {
                        return response.IsSuccessStatusCode;
                    }
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
            
            // Check for 401 Unauthorized specifically (expired token)
            if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                throw new ApiUnauthorizedException("Session expired. Please sign in again.");
            }
            
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

        public async Task UploadFileAsync(string uploadUrl, string filePath, Action<int> progressCallback, 
            CancellationToken cancellationToken = default)
        {
            progressCallback?.Invoke(0);

            // Get file size for progress calculation
            var fileInfo = new FileInfo(filePath);
            long totalBytes = fileInfo.Length;

            cancellationToken.ThrowIfCancellationRequested();
            
            // Stream the file directly from disk with progress reporting
            // Uses static _simpleUploadClient to prevent socket exhaustion
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
                        
                        // Pass cancellation token to allow cancelling during upload
                        var response = await _simpleUploadClient.PutAsync(uploadUrl, content, cancellationToken);
                        response.EnsureSuccessStatusCode();
                    }
                }
            }

            progressCallback?.Invoke(100);
        }

        /// <summary>
        /// Initiates a resumable upload session with the server.
        /// </summary>
        public async Task<ResumableUploadSession> InitiateResumableUploadAsync(string orderId, string fileName, long fileSize)
        {
            EnsureSession();
            var request = new { fileName, fileSize };
            var json = JsonConvert.SerializeObject(request);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _httpClient.PostAsync($"{_baseUrl}/api/addin/orders/{orderId}/resumable-upload", content);
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            var result = JsonConvert.DeserializeObject<ResumableUploadResponse>(responseJson);

            return new ResumableUploadSession
            {
                OrderId = orderId,
                FileName = fileName,
                FileSize = fileSize,
                SessionUri = result.SessionUri,
                StorageKey = result.StorageKey,
                BytesUploaded = 0,
                CreatedAt = DateTime.UtcNow
            };
        }

        /// <summary>
        /// Checks the status of a resumable upload.
        /// </summary>
        public async Task<ResumableUploadStatus> CheckResumableUploadStatusAsync(string sessionUri)
        {
            EnsureSession();
            var request = new { sessionUri };
            var json = JsonConvert.SerializeObject(request);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _httpClient.PostAsync($"{_baseUrl}/api/addin/resumable-upload-status", content);
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<ResumableUploadStatus>(responseJson);
        }

        /// <summary>
        /// Uploads a file using resumable upload with chunked transfer.
        /// Supports resume from interruption via the session.
        /// </summary>
        public async Task UploadFileResumableAsync(
            ResumableUploadSession session,
            string filePath,
            Action<int> progressCallback,
            Action<ResumableUploadSession> saveSessionCallback,
            CancellationToken cancellationToken = default)
        {
            const int ChunkSize = 8 * 1024 * 1024; // 8 MB chunks
            
            var fileInfo = new FileInfo(filePath);
            long totalBytes = fileInfo.Length;
            long startByte = session.BytesUploaded;

            // If we're resuming, check the actual bytes uploaded on GCS
            if (startByte > 0)
            {
                var status = await CheckResumableUploadStatusAsync(session.SessionUri);
                if (status.IsComplete)
                {
                    progressCallback?.Invoke(100);
                    return; // Already complete
                }
                if (status.BytesUploaded >= 0)
                {
                    startByte = status.BytesUploaded;
                    session.BytesUploaded = startByte;
                    saveSessionCallback?.Invoke(session);
                }
            }

            // Report initial progress
            int initialPercent = totalBytes > 0 ? (int)((startByte * 100) / totalBytes) : 0;
            progressCallback?.Invoke(initialPercent);

            using (var fileStream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                fileStream.Seek(startByte, SeekOrigin.Begin);
                long bytesUploaded = startByte;
                byte[] buffer = new byte[ChunkSize];

                while (bytesUploaded < totalBytes)
                {
                    cancellationToken.ThrowIfCancellationRequested();

                    // Calculate chunk size (may be less than ChunkSize for last chunk)
                    long remainingBytes = totalBytes - bytesUploaded;
                    int currentChunkSize = (int)Math.Min(ChunkSize, remainingBytes);

                    // Read chunk into buffer
                    int bytesRead = await ReadExactAsync(fileStream, buffer, currentChunkSize, cancellationToken);
                    if (bytesRead == 0) break;

                    // Upload chunk
                    await UploadChunkAsync(
                        session.SessionUri, 
                        buffer, 
                        bytesRead, 
                        bytesUploaded, 
                        totalBytes,
                        cancellationToken);

                    bytesUploaded += bytesRead;
                    session.BytesUploaded = bytesUploaded;

                    // Report progress
                    int percent = (int)((bytesUploaded * 100) / totalBytes);
                    progressCallback?.Invoke(percent);

                    // Save session state for resume capability
                    saveSessionCallback?.Invoke(session);
                }
            }

            progressCallback?.Invoke(100);
        }

        private async Task<int> ReadExactAsync(FileStream stream, byte[] buffer, int count, CancellationToken cancellationToken)
        {
            int totalRead = 0;
            while (totalRead < count)
            {
                int read = await stream.ReadAsync(buffer, totalRead, count - totalRead, cancellationToken);
                if (read == 0) break;
                totalRead += read;
            }
            return totalRead;
        }

        // Reusable HttpClient instances to avoid socket exhaustion
        // Creating new HttpClient for each request can exhaust available TCP ports
        private static readonly HttpClient _chunkUploadClient;
        private static readonly HttpClient _simpleUploadClient;
        private static readonly HttpClient _authClient;

        static ApiService()
        {
            _chunkUploadClient = new HttpClient();
            _chunkUploadClient.Timeout = TimeSpan.FromMinutes(10);

            _simpleUploadClient = new HttpClient();
            _simpleUploadClient.Timeout = TimeSpan.FromHours(2);

            _authClient = new HttpClient();
            _authClient.Timeout = TimeSpan.FromSeconds(30);
        }

        private async Task UploadChunkAsync(
            string sessionUri, 
            byte[] buffer, 
            int bytesRead, 
            long startByte, 
            long totalBytes,
            CancellationToken cancellationToken)
        {
            // Reuse static HttpClient to prevent socket exhaustion
            // Creating new HttpClient for each chunk can exhaust available ports
            long endByte = startByte + bytesRead - 1;
            var contentRange = $"bytes {startByte}-{endByte}/{totalBytes}";

            var request = new HttpRequestMessage(HttpMethod.Put, sessionUri);
            request.Content = new ByteArrayContent(buffer, 0, bytesRead);
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/zip");
            request.Content.Headers.ContentLength = bytesRead;
            request.Content.Headers.Add("Content-Range", contentRange);

            var response = await _chunkUploadClient.SendAsync(request, cancellationToken);

            // 200 or 201 = complete, 308 = incomplete but chunk accepted
            if (response.StatusCode != System.Net.HttpStatusCode.OK &&
                response.StatusCode != System.Net.HttpStatusCode.Created &&
                (int)response.StatusCode != 308)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                throw new HttpRequestException($"Chunk upload failed: {response.StatusCode} - {errorContent}");
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
