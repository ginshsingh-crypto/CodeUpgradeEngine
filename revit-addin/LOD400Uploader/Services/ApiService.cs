using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using LOD400Uploader.Models;
using System.Collections.Generic;

namespace LOD400Uploader.Services
{
    /// <summary>
    /// Service for communicating with the LOD 400 Delivery API
    /// </summary>
    public class ApiService
    {
        private readonly HttpClient _httpClient;
        private readonly string _baseUrl;

        public ApiService()
        {
            _httpClient = new HttpClient();
            _baseUrl = App.ApiBaseUrl;
        }

        public void SetAuthToken(string token)
        {
            _httpClient.DefaultRequestHeaders.Authorization = 
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        }

        /// <summary>
        /// Creates a new order and returns checkout URL for payment
        /// </summary>
        public async Task<CreateOrderResponse> CreateOrderAsync(int sheetCount)
        {
            var request = new CreateOrderRequest { SheetCount = sheetCount };
            var json = JsonConvert.SerializeObject(request);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _httpClient.PostAsync($"{_baseUrl}/api/addin/create-order", content);
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<CreateOrderResponse>(responseJson);
        }

        /// <summary>
        /// Gets a pre-signed URL for uploading files
        /// </summary>
        public async Task<string> GetUploadUrlAsync(string orderId, string fileName)
        {
            var request = new { fileName = fileName };
            var json = JsonConvert.SerializeObject(request);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _httpClient.PostAsync($"{_baseUrl}/api/orders/{orderId}/upload-url", content);
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            var result = JsonConvert.DeserializeObject<UploadUrlResponse>(responseJson);
            return result.UploadURL;
        }

        /// <summary>
        /// Notifies the server that file upload is complete
        /// </summary>
        public async Task MarkUploadCompleteAsync(string orderId, string fileName, long fileSize, string uploadUrl)
        {
            var request = new UploadCompleteRequest
            {
                FileName = fileName,
                FileSize = fileSize,
                UploadURL = uploadUrl
            };
            var json = JsonConvert.SerializeObject(request);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _httpClient.PostAsync($"{_baseUrl}/api/orders/{orderId}/upload-complete", content);
            response.EnsureSuccessStatusCode();
        }

        /// <summary>
        /// Gets order status with files
        /// </summary>
        public async Task<Order> GetOrderStatusAsync(string orderId)
        {
            var response = await _httpClient.GetAsync($"{_baseUrl}/api/orders/{orderId}/status");
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<Order>(responseJson);
        }

        /// <summary>
        /// Gets all orders for the current user
        /// </summary>
        public async Task<List<Order>> GetOrdersAsync()
        {
            var response = await _httpClient.GetAsync($"{_baseUrl}/api/orders");
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<List<Order>>(responseJson);
        }

        /// <summary>
        /// Gets download URL for completed order
        /// </summary>
        public async Task<DownloadUrlResponse> GetDownloadUrlAsync(string orderId)
        {
            var response = await _httpClient.GetAsync($"{_baseUrl}/api/orders/{orderId}/download-url");
            response.EnsureSuccessStatusCode();

            var responseJson = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<DownloadUrlResponse>(responseJson);
        }

        /// <summary>
        /// Uploads a file to the pre-signed URL
        /// </summary>
        public async Task UploadFileAsync(string uploadUrl, byte[] fileData, Action<int> progressCallback)
        {
            using (var client = new HttpClient())
            {
                client.Timeout = TimeSpan.FromHours(1);

                var content = new ByteArrayContent(fileData);
                content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/zip");

                var response = await client.PutAsync(uploadUrl, content);
                response.EnsureSuccessStatusCode();
            }
        }
    }
}
