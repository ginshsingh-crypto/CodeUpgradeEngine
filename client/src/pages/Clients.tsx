import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Users, Loader2 } from "lucide-react";
import type { User } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";

interface ClientWithStats extends User {
  orderCount: number;
  totalSpent: number;
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

export default function Clients() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: clients = [], isLoading } = useQuery<ClientWithStats[]>({
    queryKey: ["/api/admin/clients"],
  });

  const filteredClients = clients.filter((client) => {
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return (
      client.email?.toLowerCase().includes(search) ||
      client.firstName?.toLowerCase().includes(search) ||
      client.lastName?.toLowerCase().includes(search)
    );
  });

  const getUserInitials = (client: ClientWithStats) => {
    if (client.firstName && client.lastName) {
      return `${client.firstName[0]}${client.lastName[0]}`.toUpperCase();
    }
    if (client.email) {
      return client.email[0].toUpperCase();
    }
    return "U";
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
            <h1 className="text-lg font-semibold">Clients</h1>
            <p className="text-sm text-muted-foreground">
              View all registered clients
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-clients"
            />
          </div>
          <div className="text-sm text-muted-foreground">
            {filteredClients.length} client{filteredClients.length !== 1 ? "s" : ""}
          </div>
        </div>

        {clients.length === 0 ? (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No clients yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Clients will appear here once they sign up and create orders.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-center">Orders</TableHead>
                  <TableHead className="text-right">Total Spent</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((client) => (
                  <TableRow
                    key={client.id}
                    className="hover-elevate"
                    data-testid={`row-client-${client.id}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage
                            src={client.profileImageUrl || undefined}
                            alt={client.firstName || "Client"}
                            className="object-cover"
                          />
                          <AvatarFallback className="text-xs">
                            {getUserInitials(client)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">
                          {client.firstName} {client.lastName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {client.email || "-"}
                    </TableCell>
                    <TableCell className="text-center font-medium">
                      {client.orderCount}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(client.totalSpent)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(client.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>
    </div>
  );
}
