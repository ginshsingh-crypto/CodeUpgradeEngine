import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/StatusBadge";
import { OrderTimeline } from "@/components/OrderTimeline";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Download, Upload, FileArchive, ExternalLink, Loader2 } from "lucide-react";
import type { OrderWithFiles } from "@shared/schema";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface OrderDetailModalProps {
  order: OrderWithFiles | null;
  isOpen: boolean;
  onClose: () => void;
  onDownloadInputs?: () => void;
  onMarkComplete?: () => void;
  onDownloadOutputs?: () => void;
  isAdmin?: boolean;
  isMarkingComplete?: boolean;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-SA", {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "PPp");
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export function OrderDetailModal({
  order,
  isOpen,
  onClose,
  onDownloadInputs,
  onMarkComplete,
  onDownloadOutputs,
  isAdmin = false,
  isMarkingComplete = false,
}: OrderDetailModalProps) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);

  const getUploadUrl = async (fileName: string): Promise<string> => {
    if (!order) throw new Error("No order selected");
    
    const response = await apiRequest("POST", `/api/admin/orders/${order.id}/upload-url`, {
      fileName,
    });
    const data = await response.json();
    return data.uploadURL;
  };

  const handleUploadComplete = async (fileName: string, uploadUrl: string, fileSize: number) => {
    if (!order) return;
    
    try {
      await apiRequest("POST", `/api/admin/orders/${order.id}/upload-complete`, {
        fileName,
        fileSize,
        uploadURL: uploadUrl,
      });
    } catch (error) {
      console.error("Error completing upload:", error);
      throw error;
    }
  };

  const handleAllUploadsComplete = () => {
    setIsUploading(false);
    queryClient.invalidateQueries({ queryKey: ["/api/admin/orders"] });
    toast({
      title: "Upload Complete",
      description: "Deliverables have been uploaded successfully. You can now mark the order as complete.",
    });
    onClose();
  };

  if (!order) return null;

  const inputFiles = order.files?.filter((f) => f.fileType === "input") || [];
  const outputFiles = order.files?.filter((f) => f.fileType === "output") || [];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>Order Details</span>
            <StatusBadge status={order.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Order ID</p>
                <p className="font-mono text-xs">{order.id}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Created</p>
                <p>{formatDate(order.createdAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Sheet Count</p>
                <p className="font-medium">{order.sheetCount} sheets</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Price</p>
                <p className="font-medium text-primary">
                  {formatCurrency(order.totalPriceSar)}
                </p>
              </div>
              {isAdmin && order.user && (
                <>
                  <div>
                    <p className="text-muted-foreground">Client Name</p>
                    <p>
                      {order.user.firstName} {order.user.lastName}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Client Email</p>
                    <p>{order.user.email || "-"}</p>
                  </div>
                </>
              )}
              {order.notes && (
                <div className="col-span-2">
                  <p className="text-muted-foreground">Notes</p>
                  <p>{order.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Order Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <OrderTimeline
                  status={order.status}
                  createdAt={order.createdAt}
                  paidAt={order.paidAt}
                  uploadedAt={order.uploadedAt}
                  completedAt={order.completedAt}
                />
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    Input Files
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {inputFiles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No input files uploaded yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {inputFiles.map((file) => (
                        <div
                          key={file.id}
                          className="flex items-center gap-3 p-2 rounded-md bg-muted/50"
                        >
                          <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {file.fileName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatFileSize(file.fileSize)}
                            </p>
                          </div>
                        </div>
                      ))}
                      {isAdmin && onDownloadInputs && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full mt-2"
                          onClick={onDownloadInputs}
                          data-testid="button-download-inputs"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download All Inputs
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Download className="h-4 w-4" />
                    Output Files
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {outputFiles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No output files available yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {outputFiles.map((file) => (
                        <div
                          key={file.id}
                          className="flex items-center gap-3 p-2 rounded-md bg-muted/50"
                        >
                          <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {file.fileName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatFileSize(file.fileSize)}
                            </p>
                          </div>
                        </div>
                      ))}
                      {onDownloadOutputs && order.status === "complete" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full mt-2"
                          onClick={onDownloadOutputs}
                          data-testid="button-download-outputs"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download Deliverables
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {isAdmin && (
            <>
              <Separator />
              <div className="flex flex-wrap gap-3 justify-end">
                {(order.status === "uploaded" || order.status === "processing") && (
                  <ObjectUploader
                    getUploadUrl={getUploadUrl}
                    onUploadComplete={handleUploadComplete}
                    onAllComplete={handleAllUploadsComplete}
                    allowedFileTypes={[".zip", ".rvt", ".rfa"]}
                    buttonVariant="outline"
                    disabled={isUploading}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {isUploading ? "Uploading..." : "Upload Deliverables"}
                  </ObjectUploader>
                )}
                {order.status === "processing" && outputFiles.length > 0 && onMarkComplete && (
                  <Button
                    onClick={onMarkComplete}
                    disabled={isMarkingComplete}
                    data-testid="button-mark-complete"
                  >
                    {isMarkingComplete ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Completing...
                      </>
                    ) : (
                      "Mark Complete & Notify Client"
                    )}
                  </Button>
                )}
              </div>
            </>
          )}

          {!isAdmin && order.status === "pending" && (
            <>
              <Separator />
              <div className="flex justify-end">
                <Button asChild data-testid="button-continue-payment">
                  <a href={`/api/orders/${order.id}/checkout`} target="_blank">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Continue to Payment
                  </a>
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
