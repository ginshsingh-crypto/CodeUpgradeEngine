import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Monitor, Key, FolderOpen, Play, CheckCircle2, Copy, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export default function Downloads() {
  const { user } = useAuth();
  const { toast } = useToast();

  const handleCopyCommand = () => {
    const command = `powershell -ExecutionPolicy Bypass -Command "& {Invoke-WebRequest -Uri '${window.location.origin}/api/downloads/installer.ps1' -OutFile 'Install-LOD400.ps1'; .\\Install-LOD400.ps1 -ApiUrl '${window.location.origin}'}"`;
    navigator.clipboard.writeText(command).then(() => {
      toast({
        title: "Copied!",
        description: "Installer command copied to clipboard",
      });
    }).catch(() => {
      toast({
        title: "Copy failed",
        description: "Please copy the command manually",
        variant: "destructive",
      });
    });
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-downloads-title">Downloads</h1>
          <p className="text-muted-foreground mt-1">
            Download and install the Revit add-in to start uploading your models
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Monitor className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle>LOD 400 Uploader for Revit</CardTitle>
                  <CardDescription>Desktop add-in for Autodesk Revit</CardDescription>
                </div>
              </div>
              <Badge variant="secondary">v1.0.0</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Revit 2020-2025</p>
                  <p className="text-xs text-muted-foreground">All versions supported</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Windows 10/11</p>
                  <p className="text-xs text-muted-foreground">64-bit required</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">.NET Framework 4.8</p>
                  <p className="text-xs text-muted-foreground">Pre-installed on Windows</p>
                </div>
              </div>
            </div>

            <div className="border rounded-lg divide-y">
              <div className="p-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <Download className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Add-in Package with Installer</p>
                    <p className="text-sm text-muted-foreground">Source code + PowerShell installer script</p>
                  </div>
                </div>
                <Button asChild data-testid="button-download-compiled">
                  <a href="/api/downloads/addin-compiled.zip" download>
                    <Download className="h-4 w-4 mr-2" />
                    Download ZIP
                  </a>
                </Button>
              </div>
            </div>
            
            <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">One-time setup required</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                The add-in requires Visual Studio 2022 to compile. Once compiled, the installer will automatically copy files to the correct Revit folder.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Quick Installation
            </CardTitle>
            <CardDescription>
              Run this command in PowerShell to automatically install the add-in
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <pre className="p-4 bg-muted rounded-lg text-sm overflow-x-auto font-mono">
                <code>powershell -ExecutionPolicy Bypass -File Install-LOD400.ps1</code>
              </pre>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>The installer will auto-detect your Revit version and install to the correct folder</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Step-by-Step Setup
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-6">
              <li className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
                  1
                </div>
                <div className="flex-1 pt-1">
                  <p className="font-medium">Download and extract the ZIP file</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Click the "Download ZIP" button above and extract the contents to any folder
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
                  2
                </div>
                <div className="flex-1 pt-1">
                  <p className="font-medium">Build the add-in (one-time setup)</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Open <code className="px-1 py-0.5 bg-muted rounded text-xs">LOD400Uploader/LOD400Uploader.csproj</code> in Visual Studio 2022
                  </p>
                  <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                    <li>Update Revit API references to match your Revit version</li>
                    <li>Build in <strong>Release</strong> mode</li>
                    <li>Copy the built DLLs to the same folder as the installer</li>
                  </ul>
                </div>
              </li>
              <li className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
                  3
                </div>
                <div className="flex-1 pt-1">
                  <p className="font-medium">Run the installer</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Right-click <code className="px-1 py-0.5 bg-muted rounded text-xs">Install-LOD400.ps1</code> and select "Run with PowerShell"
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    The installer will find your Revit installation and copy the files automatically
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
                  4
                </div>
                <div className="flex-1 pt-1">
                  <p className="font-medium">Generate your API Key</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Go to{" "}
                    <a href="/settings" className="text-primary hover:underline">
                      Settings → API Keys
                    </a>{" "}
                    and create a new key. Copy it - you'll need it in the next step.
                  </p>
                </div>
              </li>
              <li className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
                  5
                </div>
                <div className="flex-1 pt-1">
                  <p className="font-medium">Open Revit and start uploading</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Launch Revit, find the <strong>LOD 400</strong> tab in the ribbon, click <strong>Upload Sheets</strong>, and enter your API key when prompted
                  </p>
                </div>
              </li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Need Help?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="p-4 border rounded-lg">
                <p className="font-medium mb-2">Add-in not showing in Revit?</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Make sure you ran the installer as Administrator</li>
                  <li>• Restart Revit after installation</li>
                  <li>• Check Add-in Manager for errors</li>
                </ul>
              </div>
              <div className="p-4 border rounded-lg">
                <p className="font-medium mb-2">Connection issues?</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Check your internet connection</li>
                  <li>• Verify your API key is correct</li>
                  <li>• Try generating a new API key</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
