import { useState, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import DashboardModal from "@uppy/react/dashboard-modal";
import AwsS3 from "@uppy/aws-s3";
import type { UploadResult, UppyFile } from "@uppy/core";
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

    uppyInstance.use(AwsS3, {
      shouldUseMultipart: false,
      getUploadParameters: async (file: UppyFile<Record<string, unknown>, Record<string, unknown>>) => {
        const url = await getUploadUrl(file.name);
        (file as any).uploadUrl = url;
        return {
          method: "PUT" as const,
          url,
          headers: {
            // CRITICAL: Must be "application/zip" to match server's signed URL signature
            // Using file.type would send "application/octet-stream" causing GCS 403 Forbidden
            "Content-Type": "application/zip",
          },
        };
      },
    });

    return uppyInstance;
  }, [getUploadUrl, maxNumberOfFiles, maxFileSize, allowedFileTypes]);

  useEffect(() => {
    const handleUploadSuccess = async (file: UppyFile<Record<string, unknown>, Record<string, unknown>> | undefined) => {
      if (file && onUploadComplete) {
        const uploadUrl = (file as any).uploadUrl;
        await onUploadComplete(file.name, uploadUrl, file.size ?? 0);
      }
    };

    const handleComplete = (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
      if (result.successful && result.successful.length > 0 && onAllComplete) {
        onAllComplete();
      }
      setShowModal(false);
      uppy.cancelAll();
    };

    uppy.on("upload-success", handleUploadSuccess);
    uppy.on("complete", handleComplete);

    return () => {
      uppy.off("upload-success", handleUploadSuccess);
      uppy.off("complete", handleComplete);
    };
  }, [uppy, onUploadComplete, onAllComplete]);

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
