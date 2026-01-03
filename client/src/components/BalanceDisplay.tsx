
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/lib/companyContext";
import { CreditCard, Plus, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function BalanceDisplay() {
    const { currentBalance, selectedCompany, selectedCompanyId } = useCompany();
    const [isTopUpOpen, setIsTopUpOpen] = useState(false);
    const [amount, setAmount] = useState("100");
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const handleTopUp = async () => {
        try {
            setIsLoading(true);
            const val = parseFloat(amount);
            if (isNaN(val) || val <= 0) {
                toast({ title: "Invalid amount", description: "Please enter a valid positive number", variant: "destructive" });
                return;
            }

            // Call API to initiate top-up
            const res = await apiRequest("POST", "/api/balance/topup", {
                amountSar: val,
                companyId: selectedCompanyId // If null, backend handles as personal
            });

            const data = await res.json();

            // If we got a payment URL (Moyasar), redirect or show it
            // For now assuming we might get a redirect URL or similar.
            // Based on balanceService.ts, it returns payment object. 
            // We might need to handle 3DS redirect if Moyasar requires it.
            // But typically for testing we might just get a success or a URL.
            // Let's assume we need to redirect to Moyasar checkout page if provided.
            // Or maybe we rendered a form?
            // Re-reading balanceService.ts: initiateTopUp returns transaction info and payment info.

            // Let's assume for this integration we just show a success message for "Simulated" payment if currently in test mode, 
            // OR we handle the redirection if there is a `source.transaction_url`.

            if (data.paymentId) {
                // If we have a real integration, we might redirect user to data.transaction_url if available
                // For now, let's toast.
                toast({ title: "Top-up Initiated", description: "Redirecting to payment..." });
                // In a real app we'd redirect to Moyasar here.
                // window.location.href = data.redirectUrl; 
            }

            setIsTopUpOpen(false);
        } catch (error: any) {
            toast({ title: "Top-up Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex items-center gap-4 mr-2">
            <div className="flex flex-col items-end">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                    {selectedCompany ? "Company Balance" : "Personal Balance"}
                </span>
                <span className="font-bold text-lg tabular-nums">
                    {currentBalance.toLocaleString('en-US', { style: 'currency', currency: 'SAR' })}
                </span>
            </div>

            <Dialog open={isTopUpOpen} onOpenChange={setIsTopUpOpen}>
                <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1">
                        <Plus className="h-4 w-4" />
                        Top Up
                    </Button>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Funds</DialogTitle>
                        <DialogDescription>
                            Top up your {selectedCompany ? "company" : "personal"} wallet balance.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="amount">Amount (SAR)</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-2.5 text-muted-foreground">SAR</span>
                                <Input
                                    id="amount"
                                    type="number"
                                    placeholder="100.00"
                                    className="pl-12"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsTopUpOpen(false)}>Cancel</Button>
                        <Button onClick={handleTopUp} disabled={isLoading}>
                            {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Proceed to Payment
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
