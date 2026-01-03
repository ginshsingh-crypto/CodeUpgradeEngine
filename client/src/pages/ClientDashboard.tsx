import { CompanyContextSwitcher } from "@/components/CompanyContextSwitcher";
import { BalanceDisplay } from "@/components/BalanceDisplay";

// ... imports

<header className="flex items-center justify-between gap-4 border-b px-4 py-3 md:px-6">
  <div className="flex items-center gap-3">
    <SidebarTrigger data-testid="button-sidebar-toggle" />
    <div>
      <h1 className="text-lg font-semibold">My Orders</h1>
      <p className="text-sm text-muted-foreground">
        Track your LOD 400 upgrade orders
      </p>
    </div>
  </div>
  <div className="flex items-center gap-2">
    <BalanceDisplay />
    <CompanyContextSwitcher />
    <ThemeToggle />
  </div>
</header>
import { useQuery } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { OrdersTable } from "@/components/OrdersTable";
import { OrderDetailModal } from "@/components/OrderDetailModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileBox,
  CheckCircle,
  Clock,
  Loader2,
  Download,
  ExternalLink,
} from "lucide-react";
import type { OrderWithFiles } from "@shared/schema";

export default function ClientDashboard() {
  const [selectedOrder, setSelectedOrder] = useState<OrderWithFiles | null>(null);

  const { data: orders = [], isLoading } = useQuery<OrderWithFiles[]>({
    queryKey: ["/api/orders"],
  });

  const stats = {
    total: orders.length,
    pending: orders.filter((o) => o.status === "pending").length,
    inProgress: orders.filter((o) =>
      ["paid", "uploaded", "processing"].includes(o.status)
    ).length,
    completed: orders.filter((o) => o.status === "complete").length,
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
            <h1 className="text-lg font-semibold">My Orders</h1>
            <p className="text-sm text-muted-foreground">
              Track your LOD 400 upgrade orders
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Orders
              </CardTitle>
              <FileBox className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                In Progress
              </CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.inProgress}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Completed
              </CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.completed}</div>
            </CardContent>
          </Card>
        </div>

        {orders.length === 0 ? (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <FileBox className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No orders yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Create your first order using the Revit add-in. Select your sheets,
                pay securely, and upload your model for LOD 400 upgrade.
              </p>
              <Button variant="outline" className="mt-4" asChild>
                <a href="/downloads">
                  <Download className="h-4 w-4 mr-2" />
                  Download Revit Add-in
                </a>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Your Orders</h2>
            <OrdersTable
              orders={orders}
              isLoading={isLoading}
              onViewOrder={setSelectedOrder}
            />
          </div>
        )}
      </main>

      <OrderDetailModal
        order={selectedOrder}
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onDownloadOutputs={handleDownloadOutputs}
      />
    </div>
  );
}
