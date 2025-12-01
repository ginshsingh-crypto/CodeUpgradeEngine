import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { OrdersTable } from "@/components/OrdersTable";
import { OrderDetailModal } from "@/components/OrderDetailModal";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Search, Loader2 } from "lucide-react";
import type { OrderWithFiles } from "@shared/schema";

type OrderStatus = "pending" | "paid" | "uploaded" | "processing" | "complete";

export default function Orders() {
  const { toast } = useToast();
  const [selectedOrder, setSelectedOrder] = useState<OrderWithFiles | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");

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

  const updateStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
      await apiRequest("PATCH", `/api/admin/orders/${orderId}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/orders"] });
      toast({
        title: "Status updated",
        description: "Order status has been updated.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update order status.",
        variant: "destructive",
      });
    },
  });

  const filteredOrders = orders.filter((order) => {
    const matchesStatus = statusFilter === "all" || order.status === statusFilter;
    const matchesSearch =
      !searchQuery ||
      order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.user?.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.user?.firstName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.user?.lastName?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

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
            <h1 className="text-lg font-semibold">Orders</h1>
            <p className="text-sm text-muted-foreground">
              View and manage all orders
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by order ID, client name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search"
            />
          </div>
          <Tabs
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
          >
            <TabsList className="flex-wrap">
              <TabsTrigger value="all">All ({orders.length})</TabsTrigger>
              <TabsTrigger value="pending">
                Pending ({orders.filter((o) => o.status === "pending").length})
              </TabsTrigger>
              <TabsTrigger value="paid">
                Paid ({orders.filter((o) => o.status === "paid").length})
              </TabsTrigger>
              <TabsTrigger value="uploaded">
                Uploaded ({orders.filter((o) => o.status === "uploaded").length})
              </TabsTrigger>
              <TabsTrigger value="processing">
                Processing ({orders.filter((o) => o.status === "processing").length})
              </TabsTrigger>
              <TabsTrigger value="complete">
                Complete ({orders.filter((o) => o.status === "complete").length})
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
