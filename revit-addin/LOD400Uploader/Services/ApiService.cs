using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using LOD400Uploader.Models;
using System.Collections.Generic;
using System.Net.Http.Headers;

namespace LOD400Uploader.Services
{
    public class ApiService
    {
        private readonly HttpClient _httpClient;
        private readonly string _baseUrl;
        private string _apiKey;

        public ApiService()
        {
            _httpClient = new HttpClient();
            _httpClient.Timeout = TimeSpan.FromMinutes(10);
            _baseUrl = App.ApiBaseUrl;
        }

        public void SetApiKey(string apiKey)
        {
            _apiKey = apiKey;
            _httpClient.DefaultRequestHeaders.Clear();
            _httpClient.DefaultRequestHeaders.Add("X-API-Key", apiKey);
        }

        public bool HasApiKey => !string.IsNullOrEmpty(_apiKey);

        public async Task<bool> ValidateApiKeyAsync(string apiKey)
        {
            try
            {
                using (var client = new HttpClient())
                {
                    client.DefaultRequestHeaders.Add("X-API-Key", apiKey);
                    var response = await client.GetAsync($"{_baseUrl}/api/addin/validate");
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
            EnsureApiKey();
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
            EnsureApiKey();
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
            EnsureApiKey();
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
            EnsureApiKey();
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
            EnsureApiKey();
            var response = await _httpClient.GetAsync($"{_baseUrl}/api/addin/orders/{orderId}/status");
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<Order>(responseJson);
        }

        public async Task<List<Order>> GetOrdersAsync()
        {
            EnsureApiKey();
            var response = await _httpClient.GetAsync($"{_baseUrl}/api/addin/orders");
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<List<Order>>(responseJson);
        }

        public async Task<DownloadUrlResponse> GetDownloadUrlAsync(string orderId)
        {
            EnsureApiKey();
            var response = await _httpClient.GetAsync($"{_baseUrl}/api/addin/orders/{orderId}/download-url");
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<DownloadUrlResponse>(responseJson);
        }

        public async Task UploadFileAsync(string uploadUrl, byte[] fileData, Action<int> progressCallback)
        {
            using (var client = new HttpClient())
            {
                client.Timeout = TimeSpan.FromHours(2);

                var content = new ByteArrayContent(fileData);
                content.Headers.ContentType = new MediaTypeHeaderValue("application/zip");

                progressCallback?.Invoke(0);
                var response = await client.PutAsync(uploadUrl, content);
                response.EnsureSuccessStatusCode();
                progressCallback?.Invoke(100);
            }
        }

        private void EnsureApiKey()
        {
            if (string.IsNullOrEmpty(_apiKey))
            {
                throw new InvalidOperationException("API key not set. Please log in first.");
            }
        }
    }
}
