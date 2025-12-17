using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace LOD400Uploader.Models
{
    public class Order
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("userId")]
        public string UserId { get; set; }

        [JsonProperty("sheetCount")]
        public int SheetCount { get; set; }

        [JsonProperty("totalPriceSar")]
        public int TotalPriceSar { get; set; }

        [JsonProperty("status")]
        public string Status { get; set; }

        [JsonProperty("stripeSessionId")]
        public string StripeSessionId { get; set; }

        [JsonProperty("stripePaymentIntentId")]
        public string StripePaymentIntentId { get; set; }

        [JsonProperty("notes")]
        public string Notes { get; set; }

        [JsonProperty("createdAt")]
        public DateTime? CreatedAt { get; set; }

        [JsonProperty("updatedAt")]
        public DateTime? UpdatedAt { get; set; }

        [JsonProperty("paidAt")]
        public DateTime? PaidAt { get; set; }

        [JsonProperty("uploadedAt")]
        public DateTime? UploadedAt { get; set; }

        [JsonProperty("completedAt")]
        public DateTime? CompletedAt { get; set; }

        [JsonProperty("files")]
        public List<OrderFile> Files { get; set; }
    }

    public class OrderFile
    {
        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("orderId")]
        public string OrderId { get; set; }

        [JsonProperty("fileType")]
        public string FileType { get; set; }

        [JsonProperty("fileName")]
        public string FileName { get; set; }

        [JsonProperty("fileSize")]
        public long? FileSize { get; set; }

        [JsonProperty("storageKey")]
        public string StorageKey { get; set; }

        [JsonProperty("mimeType")]
        public string MimeType { get; set; }

        [JsonProperty("createdAt")]
        public DateTime? CreatedAt { get; set; }
    }

    public class SheetInfo
    {
        [JsonProperty("sheetElementId")]
        public string SheetElementId { get; set; }

        [JsonProperty("sheetNumber")]
        public string SheetNumber { get; set; }

        [JsonProperty("sheetName")]
        public string SheetName { get; set; }
    }

    public class CreateOrderRequest
    {
        [JsonProperty("sheetCount")]
        public int SheetCount { get; set; }

        [JsonProperty("sheets")]
        public List<SheetInfo> Sheets { get; set; }
    }

    public class CreateOrderResponse
    {
        [JsonProperty("order")]
        public Order Order { get; set; }

        [JsonProperty("checkoutUrl")]
        public string CheckoutUrl { get; set; }
    }

    public class UploadUrlResponse
    {
        [JsonProperty("uploadURL")]
        public string UploadURL { get; set; }
    }

    public class DownloadUrlResponse
    {
        [JsonProperty("downloadURL")]
        public string DownloadURL { get; set; }

        [JsonProperty("fileName")]
        public string FileName { get; set; }
    }

    public class UploadCompleteRequest
    {
        [JsonProperty("fileName")]
        public string FileName { get; set; }

        [JsonProperty("fileSize")]
        public long FileSize { get; set; }

        [JsonProperty("uploadURL")]
        public string UploadURL { get; set; }
    }

    public class ResumableUploadResponse
    {
        [JsonProperty("sessionUri")]
        public string SessionUri { get; set; }

        [JsonProperty("storageKey")]
        public string StorageKey { get; set; }
    }

    public class ResumableUploadStatus
    {
        [JsonProperty("bytesUploaded")]
        public long BytesUploaded { get; set; }

        [JsonProperty("isComplete")]
        public bool IsComplete { get; set; }
    }

    /// <summary>
    /// Represents an active resumable upload session that can be persisted and resumed.
    /// </summary>
    public class ResumableUploadSession
    {
        [JsonProperty("orderId")]
        public string OrderId { get; set; }

        [JsonProperty("fileName")]
        public string FileName { get; set; }

        [JsonProperty("filePath")]
        public string FilePath { get; set; }

        [JsonProperty("fileSize")]
        public long FileSize { get; set; }

        [JsonProperty("sessionUri")]
        public string SessionUri { get; set; }

        [JsonProperty("storageKey")]
        public string StorageKey { get; set; }

        [JsonProperty("bytesUploaded")]
        public long BytesUploaded { get; set; }

        [JsonProperty("createdAt")]
        public DateTime CreatedAt { get; set; }

        /// <summary>
        /// Checks if this session can still be used (GCS sessions expire after 7 days).
        /// </summary>
        public bool IsExpired => DateTime.UtcNow > CreatedAt.AddDays(7);
    }
}
