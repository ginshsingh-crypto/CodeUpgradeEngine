import { useState, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import DashboardModal from "@uppy/react/dashboard-modal";
import XHRUpload from "@uppy/xhr-upload";
import { Button } from "@/components/ui/button";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  allowedFileTypes?: string[];
  getUploadUrl: (fileName: string) => Promise<string>;
  onUploadComplete?: (fileName: string, uploadUrl: string, fileSize: number) => Promise<void>;
  onAllComplete?: () => void;
  buttonClassName?: string;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  children: ReactNode;
  disabled?: boolean;
}

export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 2 * 1024 * 1024 * 1024, // 2GB - matches database bigint
  allowedFileTypes,
  getUploadUrl,
  onUploadComplete,
  onAllComplete,
  buttonClassName,
  buttonVariant = "default",
  children,
  disabled = false,
}: ObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);

  const uppy = useMemo(() => {
    const uppyInstance = new Uppy({
      restrictions: {
        maxNumberOfFiles,
        maxFileSize,
        allowedFileTypes,
      },
      autoProceed: false,
    });

    // Use XHRUpload for simple PUT to GCS signed URLs
    // AwsS3 plugin uses XML multipart handshake that GCS doesn't support
    uppyInstance.use(XHRUpload, {
      endpoint: 'placeholder', // Will be overridden per-file
      method: 'PUT',
      formData: false, // CRITICAL: Sends raw binary, not multipart form data
      fieldName: 'file',
      headers: {
        'Content-Type': 'application/zip' // Must match server/objectStorage.ts signature
      },
      // Override endpoint per file with the signed URL
      getResponseData: () => ({}),
    });

    return uppyInstance;
  }, [maxNumberOfFiles, maxFileSize, allowedFileTypes]);

  useEffect(() => {
    // When a file is added, get its signed URL and store it
    const handleFileAdded = async (file: any) => {
      try {
        const url = await getUploadUrl(file.name);
        uppy.setFileState(file.id, {
          xhrUpload: { endpoint: url }
        });
        file.uploadUrl = url;
      } catch (error) {
        console.error('Failed to get upload URL:', error);
        uppy.removeFile(file.id);
      }
    };

    const handleUploadSuccess = async (file: any) => {
      if (file && onUploadComplete) {
        const uploadUrl = file.uploadUrl;
        await onUploadComplete(file.name, uploadUrl, file.size ?? 0);
      }
    };

    const handleComplete = (result: any) => {
      if (result.successful && result.successful.length > 0 && onAllComplete) {
        onAllComplete();
      }
      setShowModal(false);
      uppy.cancelAll();
    };

    uppy.on("file-added", handleFileAdded);
    uppy.on("upload-success", handleUploadSuccess);
    uppy.on("complete", handleComplete);

    return () => {
      uppy.off("file-added", handleFileAdded);
      uppy.off("upload-success", handleUploadSuccess);
      uppy.off("complete", handleComplete);
    };
  }, [uppy, getUploadUrl, onUploadComplete, onAllComplete]);

  useEffect(() => {
    return () => {
      uppy.destroy();
    };
  }, [uppy]);

  return (
    <div>
      <Button
        onClick={() => setShowModal(true)}
        className={buttonClassName}
        variant={buttonVariant}
        disabled={disabled}
        data-testid="button-open-uploader"
      >
        {children}
      </Button>

      <DashboardModal
        uppy={uppy}
        open={showModal}
        onRequestClose={() => {
          setShowModal(false);
          uppy.cancelAll();
        }}
        proudlyDisplayPoweredByUppy={false}
        note="Upload your LOD 400 deliverables (ZIP file)"
      />
    </div>
  );
}
