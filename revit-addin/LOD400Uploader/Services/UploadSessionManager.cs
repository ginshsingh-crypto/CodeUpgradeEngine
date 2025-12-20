using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using LOD400Uploader.Models;

namespace LOD400Uploader.Services
{
    public class UploadSessionManager
    {
        private static readonly string SessionsPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "LOD400Uploader",
            "upload_sessions.json"
        );

        private List<ResumableUploadSession> _sessions;

        public UploadSessionManager()
        {
            _sessions = LoadSessions();
        }

        /// <summary>
        /// Gets an existing session for an order.
        /// NOTE: We match by orderId + fileSize only (not filePath) because the temp directory
        /// path changes each time due to GUID. The orderId is unique per order, and fileSize
        /// validates the package hasn't changed.
        /// </summary>
        public ResumableUploadSession GetExistingSession(string orderId, string filePath, long fileSize)
        {
            var session = _sessions.FirstOrDefault(s =>
                s.OrderId == orderId &&
                s.FileSize == fileSize &&
                !s.IsExpired);

            return session;
        }

        public void SaveSession(ResumableUploadSession session)
        {
            var existing = _sessions.FindIndex(s =>
                s.OrderId == session.OrderId &&
                s.SessionUri == session.SessionUri);

            if (existing >= 0)
            {
                _sessions[existing] = session;
            }
            else
            {
                _sessions.Add(session);
            }

            PersistSessions();
        }

        public void RemoveSession(ResumableUploadSession session)
        {
            _sessions.RemoveAll(s => s.SessionUri == session.SessionUri);
            PersistSessions();
        }

        public void CleanupExpiredSessions()
        {
            int removed = _sessions.RemoveAll(s => s.IsExpired);
            if (removed > 0)
            {
                PersistSessions();
            }
        }

        private List<ResumableUploadSession> LoadSessions()
        {
            try
            {
                if (File.Exists(SessionsPath))
                {
                    var json = File.ReadAllText(SessionsPath);
                    var sessions = JsonConvert.DeserializeObject<List<ResumableUploadSession>>(json);
                    return sessions ?? new List<ResumableUploadSession>();
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to load upload sessions: {ex.Message}");
            }
            return new List<ResumableUploadSession>();
        }

        private void PersistSessions()
        {
            try
            {
                var dir = Path.GetDirectoryName(SessionsPath);
                if (!Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                var json = JsonConvert.SerializeObject(_sessions, Formatting.Indented);
                File.WriteAllText(SessionsPath, json);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to save upload sessions: {ex.Message}");
            }
        }
    }
}
