import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { CompanyProvider } from "@/lib/companyContext";


import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Dashboard from "@/pages/Dashboard";
import ClientDashboard from "@/pages/ClientDashboard";
import Orders from "@/pages/Orders";
import Clients from "@/pages/Clients";
import Settings from "@/pages/Settings";
import Downloads from "@/pages/Downloads";
import NotFound from "@/pages/not-found";

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          {children}
        </div>
      </div>
    </SidebarProvider>
  );
}

import CompanyManagement from "@/pages/CompanyManagement";
import AdminRefunds from "@/pages/AdminRefunds";

// ... existing imports

import PaymentPage from "@/pages/PaymentPage";

// ... imports

function AdminRouter() {
  return (
    <AuthenticatedLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/orders" component={Orders} />
        <Route path="/clients" component={Clients} />
        <Route path="/companies" component={CompanyManagement} />
        <Route path="/refunds" component={AdminRefunds} />
        <Route path="/settings" component={Settings} />
        <Route path="/payment/:orderId" component={PaymentPage} />
        <Route component={NotFound} />
      </Switch>
    </AuthenticatedLayout>
  );
}

function ClientRouter() {
  return (
    <AuthenticatedLayout>
      <Switch>
        <Route path="/" component={ClientDashboard} />
        <Route path="/downloads" component={Downloads} />
        <Route path="/settings" component={Settings} />
        <Route path="/payment/:orderId" component={PaymentPage} />
        <Route component={NotFound} />
      </Switch>
    </AuthenticatedLayout>
  );
}

function PublicRouter() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route component={NotFound} />
    </Switch>
  );
}

function Router() {
  const { isAuthenticated, isLoading, isAdmin } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <PublicRouter />;
  }

  if (isAdmin) {
    return <AdminRouter />;
  }

  return <ClientRouter />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <CompanyProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </CompanyProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
