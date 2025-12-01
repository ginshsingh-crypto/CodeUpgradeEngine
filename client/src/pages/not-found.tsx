import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
      <div className="space-y-6 max-w-md">
        <div className="space-y-2">
          <h1 className="text-6xl font-bold text-primary">404</h1>
          <h2 className="text-2xl font-semibold">Page Not Found</h2>
          <p className="text-muted-foreground">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button variant="outline" onClick={() => window.history.back()} data-testid="button-go-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go Back
          </Button>
          <Button asChild data-testid="button-go-home">
            <a href="/">
              <Home className="h-4 w-4 mr-2" />
              Go Home
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
