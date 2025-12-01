import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { Eye, Download, Upload, CheckCircle } from "lucide-react";
import type { OrderWithFiles } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

interface OrdersTableProps {
  orders: OrderWithFiles[];
  isLoading?: boolean;
  onViewOrder: (order: OrderWithFiles) => void;
  onDownloadInputs?: (order: OrderWithFiles) => void;
  onUploadOutputs?: (order: OrderWithFiles) => void;
  onMarkComplete?: (order: OrderWithFiles) => void;
  isAdmin?: boolean;
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
  return formatDistanceToNow(d, { addSuffix: true });
}

export function OrdersTable({
  orders,
  isLoading,
  onViewOrder,
  onDownloadInputs,
  onUploadOutputs,
  onMarkComplete,
  isAdmin = false,
}: OrdersTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Eye className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">No orders yet</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {isAdmin
            ? "Orders will appear here when clients create them."
            : "Create your first order from the Revit add-in."}
        </p>
      </div>
    );
  }

  const hasInputFiles = (order: OrderWithFiles) =>
    order.files?.some((f) => f.fileType === "input");
  
  const hasOutputFiles = (order: OrderWithFiles) =>
    order.files?.some((f) => f.fileType === "output");

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[120px]">Order ID</TableHead>
            {isAdmin && <TableHead>Client</TableHead>}
            <TableHead className="text-center">Sheets</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow
              key={order.id}
              className="hover-elevate cursor-pointer"
              onClick={() => onViewOrder(order)}
              data-testid={`row-order-${order.id}`}
            >
              <TableCell className="font-mono text-sm">
                {order.id.slice(0, 8)}...
              </TableCell>
              {isAdmin && (
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">
                      {order.user?.firstName} {order.user?.lastName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {order.user?.email || "No email"}
                    </span>
                  </div>
                </TableCell>
              )}
              <TableCell className="text-center font-medium">
                {order.sheetCount}
              </TableCell>
              <TableCell className="text-right font-medium">
                {formatCurrency(order.totalPriceSar)}
              </TableCell>
              <TableCell>
                <StatusBadge status={order.status} />
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {formatDate(order.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewOrder(order);
                    }}
                    data-testid={`button-view-order-${order.id}`}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  
                  {isAdmin && hasInputFiles(order) && onDownloadInputs && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownloadInputs(order);
                      }}
                      data-testid={`button-download-inputs-${order.id}`}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                  
                  {isAdmin && order.status === "uploaded" && onUploadOutputs && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUploadOutputs(order);
                      }}
                      data-testid={`button-upload-outputs-${order.id}`}
                    >
                      <Upload className="h-4 w-4" />
                    </Button>
                  )}
                  
                  {isAdmin && order.status === "processing" && hasOutputFiles(order) && onMarkComplete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkComplete(order);
                      }}
                      data-testid={`button-mark-complete-${order.id}`}
                    >
                      <CheckCircle className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
