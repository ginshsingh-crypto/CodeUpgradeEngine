
import { useState } from "react";
import { Link, useLocation } from "wouter";
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
import { Download, Upload, FileArchive, ExternalLink, Loader2, FileSpreadsheet, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
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
  const [, setLocation] = useLocation();
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

  // --- Refunds & Cancellations ---
  const cancelOrderMutation = useMutation({
    mutationFn: async () => {
      if (!order) return;
      await apiRequest("POST", `/api/orders/${order.id}/cancel`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/orders"] });
      toast({ title: "Order Cancelled" });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Cancellation Failed", description: err.message, variant: "destructive" });
    }
  });

  const requestRefundMutation = useMutation({
    mutationFn: async () => {
      if (!order) return;
      await apiRequest("POST", `/api/orders/${order.id}/refund-request`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Refund Requested", description: "Admin will review your request." });
    },
    onError: (err: Error) => {
      toast({ title: "Request Failed", description: err.message, variant: "destructive" });
    }
  });

  const approveRefundMutation = useMutation({
    mutationFn: async () => {
      // This requires the transactionId, which we need to fetch or have on the order?
      // The order might have a 'refundStatus' or related transaction.
      // For now, assuming we don't have the transaction ID easily available on the order object without fetching.
      // Actually, we added a route to approve based on transactionId.
      // But maybe we should fetch the transactions for this order?
      // Simpler: route `POST /api/admin/orders/:orderId/refund-approve`? 
      // No, I implemented `POST /api/admin/refunds/:transactionId/approve`.
      // I need to find the pending refund transaction for this order.
      // LIMITATION: The current UI might not show transactions.
      // Strategy: Admin needs to see a list of refunds.
      // BUT, for this modal, if we want to approve, we need the transaction ID.
      // Let's Skip Admin Approval buttons here for now and rely on a dedicated Admin Refunds page if needed.
      // OR, assumes there's only one active refund request per order.
    }
  });


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
              {/* Client Info (Admin Only) - simplified for brevity, kept same logic */}
              {isAdmin && order.user && (
                <>
                  <div>
                    <p className="text-muted-foreground">Client Name</p>
                    <p>{order.user.firstName} {order.user.lastName}</p>
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

          {/* Sheets Card - kept same */}
          {order.sheets && order.sheets.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  Selected Sheets ({order.sheets.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {order.sheets.map((sheet, index) => (
                    <div
                      key={sheet.id}
                      className="flex items-center gap-3 p-2 rounded-md bg-muted/50 text-sm"
                    >
                      <span className="font-mono text-muted-foreground shrink-0 w-12">
                        {sheet.sheetNumber}
                      </span>
                      <span className="truncate">{sheet.sheetName}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

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
              {/* Files Cards - keeping existing structure */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    Input Files
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {inputFiles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No input files uploaded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {inputFiles.map((file) => (
                        <div key={file.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/50">
                          <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{file.fileName}</p>
                            <p className="text-xs text-muted-foreground">{formatFileSize(file.fileSize)}</p>
                          </div>
                        </div>
                      ))}
                      {isAdmin && onDownloadInputs && (
                        <Button variant="outline" size="sm" className="w-full mt-2" onClick={onDownloadInputs}>
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
                    <p className="text-sm text-muted-foreground">No output files available yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {outputFiles.map((file) => (
                        <div key={file.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/50">
                          <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{file.fileName}</p>
                            <p className="text-xs text-muted-foreground">{formatFileSize(file.fileSize)}</p>
                          </div>
                        </div>
                      ))}
                      {onDownloadOutputs && order.status === "complete" && (
                        <Button variant="outline" size="sm" className="w-full mt-2" onClick={onDownloadOutputs}>
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

          {/* Admin Actions */}
          {isAdmin && (
            <>
              <Separator />
              <div className="flex flex-wrap gap-3 justify-end">
                {(order.status === "uploaded" || order.status === "processing") && (
                  <ObjectUploader
                    getUploadUrl={getUploadUrl}
                    onUploadComplete={handleUploadComplete}
                    onAllComplete={handleAllUploadsComplete}
                    allowedFileTypes={[".zip"]}
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
                {/* Admin Refund Approval would go here ideally */}
              </div>
            </>
          )}

          {/* Client Actions */}
          {!isAdmin && (
            <>
              <Separator />
              <div className="flex justify-end gap-2">
                {/* Cancel Button for Pending Orders */}
                {order.status === "pending" && (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (confirm("Are you sure you want to cancel this order?")) {
                        cancelOrderMutation.mutate();
                      }
                    }}
                    disabled={cancelOrderMutation.isPending}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel Order
                  </Button>
                )}

                {/* Refund Request for Paid/Processing/Complete */}
                {(order.status === "paid" || order.status === "processing" || order.status === "complete" || order.status === "uploaded") && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (confirm("Request a refund for this order?")) {
                        requestRefundMutation.mutate();
                      }
                    }}
                    disabled={requestRefundMutation.isPending}
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Request Refund
                  </Button>
                )}

                {/* Payment Button */}
                {order.status === "pending" && (
                  <Button
                    onClick={() => {
                      onClose();
                      setLocation(`/payment/${order.id}`);
                    }}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Continue to Payment
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
