import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { User, Shield, Moon, Sun, LogOut, ExternalLink, Download, Key, Plus, Copy, Trash2, Eye, EyeOff, Check, Loader2, Lock } from "lucide-react";
import type { ApiKey } from "@shared/schema";

interface UserWithPassword {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  isAdmin: number | null;
  hasPassword: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export default function Settings() {
  const { user, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const [newKeyName, setNewKeyName] = useState("");
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const { data: userDetails } = useQuery<UserWithPassword>({
    queryKey: ["/api/auth/user"],
  });

  const { data: apiKeys, isLoading: keysLoading } = useQuery<ApiKey[]>({
    queryKey: ["/api/user/api-keys"],
    enabled: !isAdmin,
  });

  const setPasswordMutation = useMutation({
    mutationFn: async (password: string) => {
      const response = await apiRequest("POST", "/api/auth/set-password", { password });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to set password");
      }
      return response.json();
    },
    onSuccess: () => {
      setPassword("");
      setConfirmPassword("");
      setPasswordError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Password Set",
        description: "Your add-in login password has been set successfully. You can now log in from the Revit add-in.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to set password. Please try again.",
      });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
      const response = await apiRequest("POST", "/api/auth/change-password", { currentPassword, newPassword });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to change password");
      }
      return response.json();
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPasswordError(null);
      toast({
        title: "Password Changed",
        description: "Your add-in login password has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to change password. Please try again.",
      });
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await apiRequest("POST", "/api/user/api-keys", { name });
      return response.json();
    },
    onSuccess: (data) => {
      setShowNewKey(data.rawKey);
      setNewKeyName("");
      queryClient.invalidateQueries({ queryKey: ["/api/user/api-keys"] });
      toast({
        title: "API Key Created",
        description: "Your new API key has been created. Copy it now - you won't be able to see it again!",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create API key. Please try again.",
      });
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async (keyId: string) => {
      await apiRequest("DELETE", `/api/user/api-keys/${keyId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/api-keys"] });
      toast({
        title: "API Key Deleted",
        description: "The API key has been revoked and can no longer be used.",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete API key. Please try again.",
      });
    },
  });

  const handleCopyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      toast({
        variant: "destructive",
        title: "Copy Failed",
        description: "Could not copy to clipboard. Please select and copy manually.",
      });
    }
  };

  const handleCreateKey = () => {
    if (newKeyName.trim()) {
      setShowNewKey(null);
      setCopiedKey(false);
      createKeyMutation.mutate(newKeyName.trim());
    }
  };

  const handleSetPassword = () => {
    setPasswordError(null);
    
    if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }
    
    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    
    setPasswordMutation.mutate(password);
  };

  const handleChangePassword = () => {
    setPasswordError(null);
    
    if (!currentPassword) {
      setPasswordError("Current password is required");
      return;
    }
    
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters");
      return;
    }
    
    if (newPassword !== confirmNewPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    
    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

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
            <>
              <Card data-testid="card-addin-password">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lock className="h-5 w-5" />
                    Add-in Login
                  </CardTitle>
                  <CardDescription>
                    Set a password to log in from the Revit add-in using your email and password.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {userDetails?.hasPassword ? (
                    <>
                      <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md">
                        <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                        <span className="text-sm text-green-700 dark:text-green-300" data-testid="text-password-status">
                          Password is set. You can log in to the Revit add-in using your email.
                        </span>
                      </div>
                      <Separator />
                      <div className="space-y-3">
                        <h4 className="text-sm font-medium">Change Password</h4>
                        <div className="space-y-2">
                          <Label htmlFor="current-password">Current Password</Label>
                          <div className="relative">
                            <Input
                              id="current-password"
                              type={showPassword ? "text" : "password"}
                              placeholder="Enter current password"
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                              data-testid="input-current-password"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="new-password">New Password</Label>
                          <Input
                            id="new-password"
                            type={showPassword ? "text" : "password"}
                            placeholder="Minimum 8 characters"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            data-testid="input-new-password"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="confirm-new-password">Confirm New Password</Label>
                          <Input
                            id="confirm-new-password"
                            type={showPassword ? "text" : "password"}
                            placeholder="Re-enter new password"
                            value={confirmNewPassword}
                            onChange={(e) => setConfirmNewPassword(e.target.value)}
                            data-testid="input-confirm-new-password"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            data-testid="button-toggle-password-visibility"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            {showPassword ? "Hide" : "Show"} passwords
                          </span>
                        </div>
                        {passwordError && (
                          <p className="text-sm text-destructive" data-testid="text-password-error">{passwordError}</p>
                        )}
                        <Button
                          onClick={handleChangePassword}
                          disabled={!currentPassword || !newPassword || !confirmNewPassword || changePasswordMutation.isPending}
                          data-testid="button-change-password"
                        >
                          {changePasswordMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Lock className="h-4 w-4 mr-2" />
                          )}
                          Change Password
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Set a password to enable email/password login from the Revit add-in. This is the recommended authentication method.
                      </p>
                      <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          placeholder="Minimum 8 characters"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          data-testid="input-set-password"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="confirm-password">Confirm Password</Label>
                        <Input
                          id="confirm-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="Re-enter password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          data-testid="input-confirm-set-password"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          data-testid="button-toggle-password-visibility-set"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          {showPassword ? "Hide" : "Show"} passwords
                        </span>
                      </div>
                      {passwordError && (
                        <p className="text-sm text-destructive" data-testid="text-password-error">{passwordError}</p>
                      )}
                      <Button
                        onClick={handleSetPassword}
                        disabled={!password || !confirmPassword || setPasswordMutation.isPending}
                        data-testid="button-set-password"
                      >
                        {setPasswordMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Lock className="h-4 w-4 mr-2" />
                        )}
                        Set Password
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5" />
                    API Keys
                    <Badge variant="secondary" className="text-xs">Legacy</Badge>
                  </CardTitle>
                  <CardDescription>
                    API keys for the Revit add-in. <span className="text-muted-foreground font-medium">Password login is now recommended.</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {showNewKey && (
                    <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md space-y-2">
                      <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                        <Check className="h-4 w-4" />
                        <span className="font-medium">New API Key Created</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Copy this key now. You won't be able to see it again!
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 p-2 bg-background border rounded text-sm font-mono break-all">
                          {showNewKey}
                        </code>
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => handleCopyKey(showNewKey)}
                          data-testid="button-copy-new-key"
                        >
                          {copiedKey ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowNewKey(null)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Input
                      placeholder="Key name (e.g., 'My Workstation')"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateKey()}
                      data-testid="input-api-key-name"
                    />
                    <Button
                      onClick={handleCreateKey}
                      disabled={!newKeyName.trim() || createKeyMutation.isPending}
                      data-testid="button-create-api-key"
                    >
                      {createKeyMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  {keysLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : apiKeys && apiKeys.length > 0 ? (
                    <div className="space-y-2">
                      {apiKeys.map((key) => (
                        <div
                          key={key.id}
                          className="flex items-center justify-between p-3 border rounded-md"
                          data-testid={`api-key-row-${key.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{key.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {key.createdAt && <>Created {new Date(key.createdAt).toLocaleDateString()}</>}
                              {key.lastUsed && (
                                <> · Last used {new Date(key.lastUsed).toLocaleDateString()}</>
                              )}
                            </div>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteKeyMutation.mutate(key.id)}
                            disabled={deleteKeyMutation.isPending}
                            data-testid={`button-delete-key-${key.id}`}
                          >
                            {deleteKeyMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No API keys yet. Create one to use with the Revit add-in.
                    </p>
                  )}
                </CardContent>
              </Card>

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
            </>
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
