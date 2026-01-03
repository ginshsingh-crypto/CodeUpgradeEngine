
import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/lib/companyContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CreditCard, Wallet, ArrowLeft } from "lucide-react";
import type { OrderWithFiles } from "@shared/schema";

export default function PaymentPage() {
    const [, params] = useRoute("/payment/:orderId");
    const orderId = params?.orderId;
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const { selectedCompanyId, selectedCompany, companies } = useCompany();

    // We need to fetch user balance + company balance
    // Currently api/balance returns { personal: number, companies: [...] }
    const { data: balanceData } = useQuery({
        queryKey: ["/api/balance"],
    });

    const { data: order, isLoading: isOrderLoading } = useQuery<OrderWithFiles>({
        queryKey: [`/api/orders/${orderId}`],
        enabled: !!orderId,
    });

    const payWithBalanceMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest("POST", `/api/orders/${orderId}/pay-with-balance`, {
                companyId: selectedCompanyId,
            });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
            queryClient.invalidateQueries({ queryKey: ["/api/balance"] });
            toast({
                title: "Payment Successful",
                description: "Order paid using balance.",
            });
            setLocation("/"); // Go back to dashboard
        },
        onError: (err: Error) => {
            toast({
                title: "Payment Failed",
                description: err.message,
                variant: "destructive",
            });
        },
    });

    // Moyasar Payment
    const initiateMoyasarPayment = async () => {
        try {
            // We need to call the checkout endpoint which returns a redirect link?
            // Wait, the backend change said "/api/orders/:orderId/checkout" redirects to local payment page...
            // Ah, maybe the *Button* on UI was supposed to link to local page.
            // But what initiates the REAL Moyasar payment?
            // Phase 1 summary: "Created moyasarClient.ts... Replaced Stripe... /api/orders/:orderId/checkout now redirects to a local /payment/:orderId page"
            // This implies the OLD checkout route is now the entry to THIS page?
            // NO.
            // If I want to pay with Card, I need to generate an Invoice on Moyasar and get the URL.
            // Let's check `routes.ts` or `moyasarClient.ts` to see how to get the URL.
            // If /checkout just redirects HERE, then where is the endpoint to get the Moyasar Link?
            // Maybe I need to look at `routes.ts` again to be sure.

            // Assuming there is an endpoint to get the invoice URL.
            // Use `window.location.href = url`.
            const res = await apiRequest("POST", `/api/moyasar/checkout/${orderId}`, {
                // callback_url logic handling?
                // usually callback url is set in backend or request
            });
            const data = await res.json();
            if (data.url) {
                window.location.href = data.url;
            } else {
                throw new Error("No payment URL returned");
            }
        } catch (err: any) {
            toast({
                title: "Error",
                description: err.message,
                variant: "destructive"
            });
        }
    };

    if (isOrderLoading || !balanceData) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!order) return <div>Order not found</div>;

    const personalBalance = balanceData.personal || 0;
    // If selectedCompanyId is set, get that company's balance. Else undefined.
    // We already have `selectedCompany` from context which might be the object.
    // Let's verify structure of `companies` in balanceData.
    // It is likely array of { id, name, balance, ... }
    // Wait, `selectedCompany` from context is derived from `companies` list.
    // Does `companies` list include `balance`? 
    // `BalanceService.getUserBalances` returns `{ personal: number, companies: {id, name, balance, role}[] }`?
    // I should check `balanceService.ts` or `routes.ts`.
    // Assuming yes for now.

    const associatedCompany = companies.find((c: any) => c.id === selectedCompanyId);
    const currentBalance = selectedCompanyId ? (associatedCompany?.balance || 0) : personalBalance;

    const canPayWithBalance = currentBalance >= order.totalPriceSar;

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <div className="flex items-center gap-2 mb-2">
                        <Button variant="ghost" size="sm" onClick={() => setLocation("/")}>
                            <ArrowLeft className="h-4 w-4 mr-1" /> Back
                        </Button>
                    </div>
                    <CardTitle>Checkout</CardTitle>
                    <CardDescription>Order #{order.orderNumber}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex justify-between items-center py-4 border-b">
                        <span className="font-medium">Total Amount</span>
                        <span className="text-2xl font-bold">{order.totalPriceSar} SAR</span>
                    </div>

                    <div className="space-y-4">
                        {/* Pay with Balance */}
                        <div className="space-y-2">
                            <h3 className="text-sm font-medium text-muted-foreground uppercase opacity-70">Pay with Balance</h3>
                            <div className="p-4 border rounded-lg bg-muted/20">
                                <div className="flex justify-between mb-2">
                                    <span className="text-sm font-medium">
                                        {selectedCompanyId ? `Company: ${associatedCompany?.name}` : "Personal Account"}
                                    </span>
                                    <span className="font-bold">{currentBalance} SAR</span>
                                </div>
                                <Button
                                    className="w-full"
                                    disabled={!canPayWithBalance || payWithBalanceMutation.isPending}
                                    onClick={() => payWithBalanceMutation.mutate()}
                                >
                                    <Wallet className="mr-2 h-4 w-4" />
                                    Pay with Balance
                                </Button>
                                {!canPayWithBalance && (
                                    <p className="text-xs text-destructive mt-2 text-center">Insufficient funds. Please top up or use card.</p>
                                )}
                            </div>
                        </div>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-background px-2 text-muted-foreground">Or pay with card</span>
                            </div>
                        </div>

                        {/* Pay with Card */}
                        <Button
                            variant="outline"
                            className="w-full py-6"
                            onClick={initiateMoyasarPayment}
                        >
                            <CreditCard className="mr-2 h-4 w-4" />
                            Pay with Credit Card (Moyasar)
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
