import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Clock, CreditCard, Upload, Cog, CheckCircle } from "lucide-react";

type OrderStatus = "pending" | "paid" | "uploaded" | "processing" | "complete";

interface StatusBadgeProps {
  status: OrderStatus;
  className?: string;
}

const statusConfig: Record<
  OrderStatus,
  { label: string; className: string; icon: typeof Clock }
> = {
  pending: {
    label: "Pending Payment",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    icon: Clock,
  },
  paid: {
    label: "Paid",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    icon: CreditCard,
  },
  uploaded: {
    label: "Files Uploaded",
    className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800",
    icon: Upload,
  },
  processing: {
    label: "Processing",
    className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800",
    icon: Cog,
  },
  complete: {
    label: "Complete",
    className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
    icon: CheckCircle,
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium gap-1.5 no-default-hover-elevate",
        config.className,
        className
      )}
      data-testid={`badge-status-${status}`}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
