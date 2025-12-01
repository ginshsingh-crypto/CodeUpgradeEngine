import { cn } from "@/lib/utils";
import { Check, Clock, CreditCard, Upload, Cog, CheckCircle } from "lucide-react";

type OrderStatus = "pending" | "paid" | "uploaded" | "processing" | "complete";

interface OrderTimelineProps {
  status: OrderStatus;
  createdAt?: Date | string | null;
  paidAt?: Date | string | null;
  uploadedAt?: Date | string | null;
  completedAt?: Date | string | null;
}

const steps = [
  { status: "pending", label: "Order Created", icon: Clock },
  { status: "paid", label: "Payment Received", icon: CreditCard },
  { status: "uploaded", label: "Files Uploaded", icon: Upload },
  { status: "processing", label: "Processing", icon: Cog },
  { status: "complete", label: "Complete", icon: CheckCircle },
] as const;

const statusOrder: OrderStatus[] = ["pending", "paid", "uploaded", "processing", "complete"];

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrderTimeline({
  status,
  createdAt,
  paidAt,
  uploadedAt,
  completedAt,
}: OrderTimelineProps) {
  const currentIndex = statusOrder.indexOf(status);
  
  const dates: Record<string, Date | string | null | undefined> = {
    pending: createdAt,
    paid: paidAt,
    uploaded: uploadedAt,
    processing: status === "processing" || status === "complete" ? uploadedAt : null,
    complete: completedAt,
  };

  return (
    <div className="space-y-4" data-testid="order-timeline">
      {steps.map((step, index) => {
        const stepIndex = statusOrder.indexOf(step.status);
        const isCompleted = stepIndex < currentIndex;
        const isCurrent = stepIndex === currentIndex;
        const isPending = stepIndex > currentIndex;
        const Icon = step.icon;
        const date = dates[step.status];

        return (
          <div key={step.status} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors",
                  isCompleted
                    ? "border-green-500 bg-green-500 text-white"
                    : isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted bg-muted text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "w-0.5 flex-1 min-h-6",
                    isCompleted ? "bg-green-500" : "bg-muted"
                  )}
                />
              )}
            </div>
            <div className="flex-1 pb-4">
              <p
                className={cn(
                  "font-medium text-sm",
                  isPending ? "text-muted-foreground" : "text-foreground"
                )}
              >
                {step.label}
              </p>
              {date && !isPending && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDate(date)}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
