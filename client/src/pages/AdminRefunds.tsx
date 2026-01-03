
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";

interface RefundRequest {
    id: string;
    amountSar: number;
    status: string;
    createdAt: string;
    note?: string;
    user: {
        firstName: string;
        lastName: string;
        email: string;
    };
    order: {
        sheetCount: number;
        totalPriceSar: number;
    };
}

export default function AdminRefunds() {
    const { toast } = useToast();
    const [rejectNote, setRejectNote] = useState("");
    const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

    const { data: requests, isLoading } = useQuery<RefundRequest[]>({
        queryKey: ["/api/admin/refunds"],
    });

    const approveMutation = useMutation({
        mutationFn: async (id: string) => {
            await apiRequest("POST", `/api/admin/refunds/${id}/approve`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/refunds"] });
            toast({ title: "Refund Approved", description: "The refund has been processed successfully." });
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        },
    });

    const rejectMutation = useMutation({
        mutationFn: async ({ id, note }: { id: string; note: string }) => {
            await apiRequest("POST", `/api/admin/refunds/${id}/reject`, { note });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/refunds"] });
            toast({ title: "Refund Rejected", description: "The refund request has been rejected." });
            setSelectedRequestId(null);
            setRejectNote("");
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        },
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="p-8 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Refund Requests</h1>
                    <p className="text-muted-foreground mt-2">Manage pending refund approval requests.</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Pending Requests</CardTitle>
                    <CardDescription>Review and action customer refund requests.</CardDescription>
                </CardHeader>
                <CardContent>
                    {!requests?.length ? (
                        <div className="text-center py-8 text-muted-foreground">
                            No pending refund requests found.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>User</TableHead>
                                    <TableHead>Amount</TableHead>
                                    <TableHead>Order Details</TableHead>
                                    <TableHead>Reason</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {requests.map((request) => (
                                    <TableRow key={request.id}>
                                        <TableCell className="whitespace-nowrap">
                                            {format(new Date(request.createdAt), "dd MMM yyyy")}
                                        </TableCell>
                                        <TableCell>
                                            <div className="font-medium">{request.user.firstName} {request.user.lastName}</div>
                                            <div className="text-xs text-muted-foreground">{request.user.email}</div>
                                        </TableCell>
                                        <TableCell className="font-medium text-red-600">
                                            -{Math.abs(request.amountSar).toFixed(2)} SAR
                                        </TableCell>
                                        <TableCell>
                                            {request.order.sheetCount} sheets
                                        </TableCell>
                                        <TableCell className="max-w-[200px] truncate" title={request.note}>
                                            {request.note || "No reason provided"}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="default"
                                                    className="bg-green-600 hover:bg-green-700"
                                                    onClick={() => approveMutation.mutate(request.id)}
                                                    disabled={approveMutation.isPending}
                                                >
                                                    {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
                                                    Approve
                                                </Button>

                                                <Dialog open={selectedRequestId === request.id} onOpenChange={(open) => !open && setSelectedRequestId(null)}>
                                                    <DialogTrigger asChild>
                                                        <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            onClick={() => setSelectedRequestId(request.id)}
                                                        >
                                                            <XCircle className="h-4 w-4 mr-1" />
                                                            Reject
                                                        </Button>
                                                    </DialogTrigger>
                                                    <DialogContent>
                                                        <DialogHeader>
                                                            <DialogTitle>Reject Refund Request</DialogTitle>
                                                            <DialogDescription>
                                                                Please provide a reason for rejecting this refund request. This will be visible to the user.
                                                            </DialogDescription>
                                                        </DialogHeader>
                                                        <Textarea
                                                            placeholder="Reason for rejection..."
                                                            value={rejectNote}
                                                            onChange={(e) => setRejectNote(e.target.value)}
                                                        />
                                                        <DialogFooter>
                                                            <Button variant="outline" onClick={() => setSelectedRequestId(null)}>Cancel</Button>
                                                            <Button
                                                                variant="destructive"
                                                                onClick={() => rejectMutation.mutate({ id: request.id, note: rejectNote })}
                                                                disabled={!rejectNote.trim() || rejectMutation.isPending}
                                                            >
                                                                {rejectMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                                                                Confirm Rejection
                                                            </Button>
                                                        </DialogFooter>
                                                    </DialogContent>
                                                </Dialog>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
