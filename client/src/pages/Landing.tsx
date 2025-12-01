import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Building2,
  CheckCircle,
  FileBox,
  Shield,
  Zap,
  ArrowRight,
  Layers,
} from "lucide-react";

const features = [
  {
    icon: Layers,
    title: "LOD 400 Precision",
    description:
      "Production-ready models with fabrication-level detail for accurate construction.",
  },
  {
    icon: Zap,
    title: "Fast Turnaround",
    description:
      "Efficient processing workflow ensures your deliverables are ready quickly.",
  },
  {
    icon: Shield,
    title: "Secure Transfer",
    description:
      "Your Revit models are encrypted and securely handled throughout the process.",
  },
  {
    icon: FileBox,
    title: "Easy Integration",
    description:
      "Seamless Revit add-in for direct model upload and delivery downloads.",
  },
];

const steps = [
  {
    number: "01",
    title: "Select Sheets",
    description: "Choose the sheets you need upgraded from your Revit model.",
  },
  {
    number: "02",
    title: "Pay Securely",
    description: "150 SAR per sheet. Secure payment through Stripe.",
  },
  {
    number: "03",
    title: "Upload Model",
    description: "Our add-in packages and uploads your model automatically.",
  },
  {
    number: "04",
    title: "Get Deliverables",
    description: "Receive your LOD 400 upgraded model within days.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
              <Building2 className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-lg hidden sm:inline-block">
              LOD 400 Delivery
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button asChild data-testid="button-login">
              <a href="/api/login">Sign In</a>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative py-20 md:py-32 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="container px-4 md:px-6 relative">
            <div className="flex flex-col items-center text-center max-w-3xl mx-auto space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
                <CheckCircle className="h-4 w-4" />
                Professional BIM Model Upgrades
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
                Transform Your Models to{" "}
                <span className="text-primary">LOD 400</span>
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl">
                Professional LOD 300 to LOD 400 model upgrades for construction
                documentation. Upload directly from Revit and receive
                production-ready deliverables.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" asChild data-testid="button-get-started">
                  <a href="/api/login">
                    Get Started
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  data-testid="button-learn-more"
                >
                  <a href="#how-it-works">Learn More</a>
                </Button>
              </div>
              <div className="flex items-center gap-6 pt-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  150 SAR per sheet
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Secure payment
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Fast delivery
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 border-t bg-muted/30" id="features">
          <div className="container px-4 md:px-6">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-4">Why Choose Us</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                We specialize in delivering high-quality LOD 400 upgrades that
                meet construction and fabrication requirements.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature) => (
                <Card key={feature.title} className="hover-elevate">
                  <CardContent className="pt-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 mb-4">
                      <feature.icon className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="font-semibold mb-2">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 border-t" id="how-it-works">
          <div className="container px-4 md:px-6">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-4">How It Works</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                A simple, streamlined process from order to delivery.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
              {steps.map((step, index) => (
                <div key={step.number} className="relative">
                  <div className="text-5xl font-bold text-primary/10 mb-4">
                    {step.number}
                  </div>
                  <h3 className="font-semibold mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {step.description}
                  </p>
                  {index < steps.length - 1 && (
                    <ArrowRight className="hidden lg:block absolute top-8 -right-4 h-6 w-6 text-muted-foreground/30" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 border-t bg-primary/5">
          <div className="container px-4 md:px-6">
            <div className="flex flex-col items-center text-center max-w-2xl mx-auto space-y-6">
              <h2 className="text-3xl font-bold">Ready to Get Started?</h2>
              <p className="text-muted-foreground">
                Sign in to access the platform and start upgrading your BIM
                models to LOD 400 today.
              </p>
              <Button size="lg" asChild>
                <a href="/api/login">
                  Sign In to Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="container px-4 md:px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <span className="font-medium">LOD 400 Delivery Platform</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Professional BIM model upgrades for construction excellence.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
