import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { User, Shield, Moon, Sun, LogOut, ExternalLink, Download } from "lucide-react";

export default function Settings() {
  const { user, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const getUserInitials = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user?.email) {
      return user.email[0].toUpperCase();
    }
    return "U";
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <SidebarTrigger data-testid="button-sidebar-toggle" />
          <div>
            <h1 className="text-lg font-semibold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your account and preferences
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-6">
        <div className="max-w-2xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Profile
              </CardTitle>
              <CardDescription>
                Your account information from your sign-in provider.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarImage
                    src={user?.profileImageUrl || undefined}
                    alt={user?.firstName || "User"}
                    className="object-cover"
                  />
                  <AvatarFallback className="text-lg">
                    {getUserInitials()}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">
                      {user?.firstName} {user?.lastName}
                    </h3>
                    {isAdmin && (
                      <Badge variant="secondary" className="gap-1">
                        <Shield className="h-3 w-3" />
                        Admin
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {user?.email || "No email associated"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {theme === "dark" ? (
                  <Moon className="h-5 w-5" />
                ) : (
                  <Sun className="h-5 w-5" />
                )}
                Appearance
              </CardTitle>
              <CardDescription>
                Customize how the application looks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="dark-mode">Dark Mode</Label>
                  <p className="text-sm text-muted-foreground">
                    Switch between light and dark themes.
                  </p>
                </div>
                <Switch
                  id="dark-mode"
                  checked={theme === "dark"}
                  onCheckedChange={toggleTheme}
                  data-testid="switch-dark-mode"
                />
              </div>
            </CardContent>
          </Card>

          {!isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="h-5 w-5" />
                  Revit Add-in
                </CardTitle>
                <CardDescription>
                  Download and install the add-in to submit orders directly from Revit.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" asChild>
                  <a
                    href="https://github.com/LOD400/revit-addin/releases"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Add-in
                    <ExternalLink className="h-3 w-3 ml-2" />
                  </a>
                </Button>
              </CardContent>
            </Card>
          )}

          <Separator />

          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Sign Out</CardTitle>
              <CardDescription>
                Sign out of your account on this device.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" asChild data-testid="button-signout">
                <a href="/api/logout">
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
