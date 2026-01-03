
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { StatsCard } from "@/components/StatsCard";
import { OrdersTable } from "@/components/OrdersTable";
import { OrderDetailModal } from "@/components/OrderDetailModal";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  FileBox,
  Clock,
  DollarSign,
  Loader2,
} from "lucide-react";
import type { OrderWithFiles } from "@shared/schema";
import { CompanyContextSwitcher } from "@/components/CompanyContextSwitcher";
import { useCompany } from "@/lib/companyContext";

type OrderStatus = "pending" | "paid" | "uploaded" | "processing" | "complete";

export default function Dashboard() {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const [selectedOrder, setSelectedOrder] = useState<OrderWithFiles | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");

  const { data: orders = [], isLoading } = useQuery<OrderWithFiles[]>({
    queryKey: ["/api/admin/orders"],
  });

  const markCompleteMutation = useMutation({
    mutationFn: async (orderId: string) => {
      await apiRequest("POST", `/api/admin/orders/${orderId}/complete`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/orders"] });
      toast({
        title: "Order completed",
        description: "The client has been notified via email.",
      });
      setSelectedOrder(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to mark order as complete.",
        variant: "destructive",
      });
    },
  });

  const filteredOrders = orders.filter((order) =>
    statusFilter === "all" ? true : order.status === statusFilter
  );

  const stats = {
    total: orders.length,
    pending: orders.filter((o) => o.status === "pending").length,
    inProgress: orders.filter((o) =>
      ["paid", "uploaded", "processing"].includes(o.status)
    ).length,
    completed: orders.filter((o) => o.status === "complete").length,
    revenue: orders
      .filter((o) => o.status !== "pending")
      .reduce((acc, o) => acc + o.totalPriceSar, 0),
  };

  const handleDownloadInputs = async (order: OrderWithFiles) => {
    const inputFile = order.files?.find((f) => f.fileType === "input");
    if (inputFile) {
      window.open(`/api/files/${inputFile.id}/download`, "_blank");
    }
  };

  const handleDownloadOutputs = async () => {
    if (selectedOrder) {
      const outputFile = selectedOrder.files?.find((f) => f.fileType === "output");
      if (outputFile) {
        window.open(`/api/files/${outputFile.id}/download`, "_blank");
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <SidebarTrigger data-testid="button-sidebar-toggle" />
          <div>
            <h1 className="text-lg font-semibold">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Manage your LOD 400 orders
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CompanyContextSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Total Orders"
            value={stats.total}
            icon={FileBox}
            description="All time orders"
          />
          <StatsCard
            title="Pending"
            value={stats.pending}
            icon={Clock}
            description="Awaiting payment or upload"
          />
          <StatsCard
            title="In Progress"
            value={stats.inProgress}
            icon={FileBox}
            description="Being processed"
          />
          <StatsCard
            title="Revenue"
            value={`${stats.revenue.toLocaleString()} SAR`}
            icon={DollarSign}
            description="Total earnings"
          />
        </div>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Recent Orders</h2>
            <Tabs
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
            >
              <TabsList>
                <TabsTrigger value="all" data-testid="filter-all">
                  All
                </TabsTrigger>
                <TabsTrigger value="pending" data-testid="filter-pending">
                  Pending
                </TabsTrigger>
                <TabsTrigger value="uploaded" data-testid="filter-uploaded">
                  Uploaded
                </TabsTrigger>
                <TabsTrigger value="processing" data-testid="filter-processing">
                  Processing
                </TabsTrigger>
                <TabsTrigger value="complete" data-testid="filter-complete">
                  Complete
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <OrdersTable
            orders={filteredOrders}
            isLoading={isLoading}
            isAdmin={true}
            onViewOrder={setSelectedOrder}
            onDownloadInputs={handleDownloadInputs}
            onUploadOutputs={(order) => {
              setSelectedOrder(order);
            }}
            onMarkComplete={(order) => {
              markCompleteMutation.mutate(order.id);
            }}
          />
        </div>
      </main>

      <OrderDetailModal
        order={selectedOrder}
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        isAdmin={true}
        onDownloadInputs={() => {
          if (selectedOrder) handleDownloadInputs(selectedOrder);
        }}
        onDownloadOutputs={handleDownloadOutputs}
        onMarkComplete={() => {
          if (selectedOrder) {
            markCompleteMutation.mutate(selectedOrder.id);
          }
        }}
        isMarkingComplete={markCompleteMutation.isPending}
      />
    </div>
  );
}
