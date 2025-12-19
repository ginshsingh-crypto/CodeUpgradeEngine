import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Building2,
  CheckCircle,
  FileBox,
  Shield,
  Zap,
  ArrowRight,
  Layers,
  Download,
  Clock,
  Upload,
  CreditCard,
  Mail,
  Phone,
  MapPin,
} from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import heroImage from "@assets/stock_images/modern_architecture__f227963c.jpg";

const features = [
  {
    icon: Layers,
    title: "LOD 400 Precision",
    description:
      "Production-ready models with fabrication-level detail for accurate construction documentation.",
  },
  {
    icon: Zap,
    title: "Fast Turnaround",
    description:
      "Efficient processing workflow ensures your deliverables are ready within days.",
  },
  {
    icon: Shield,
    title: "Secure Transfer",
    description:
      "Your Revit models are encrypted and securely handled throughout the entire process.",
  },
  {
    icon: FileBox,
    title: "Easy Integration",
    description:
      "Seamless Revit add-in for direct model upload and automatic delivery downloads.",
  },
  {
    icon: CheckCircle,
    title: "Quality Assurance",
    description:
      "Every model undergoes rigorous quality checks to ensure fabrication-ready output.",
  },
  {
    icon: Clock,
    title: "24/7 Support",
    description:
      "Dedicated support team available around the clock to assist with your projects.",
  },
];

const steps = [
  {
    number: "01",
    title: "Select Sheets",
    description: "Choose the sheets you need upgraded from your Revit model.",
    icon: Layers,
  },
  {
    number: "02",
    title: "Pay Securely",
    description: "150 SAR per sheet. Secure payment through Stripe.",
    icon: CreditCard,
  },
  {
    number: "03",
    title: "Upload Model",
    description: "Our add-in packages and uploads your model automatically.",
    icon: Upload,
  },
  {
    number: "04",
    title: "Get Deliverables",
    description: "Receive your LOD 400 upgraded model within days.",
    icon: Download,
  },
];

export default function Landing() {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        toast({
          title: "Message Sent",
          description: "We'll get back to you as soon as possible.",
        });
        setFormData({ name: "", email: "", message: "" });
      } else {
        toast({
          title: "Error",
          description: data.message || "Failed to send message. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send message. Please check your connection.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="fixed top-0 z-50 w-full border-b border-white/10 bg-zinc-950/80 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-500">
              <Building2 className="h-5 w-5 text-zinc-950" />
            </div>
            <span className="font-semibold text-lg hidden sm:inline-block text-white">
              LOD 400 Delivery
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              className="text-white/80 border-white/10" 
              asChild 
              data-testid="button-download-addin"
            >
              <a href="/api/downloads/addin-compiled.zip" download>
                <Download className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Download Add-in</span>
                <span className="sm:hidden">Add-in</span>
              </a>
            </Button>
            <Button 
              variant="ghost"
              className="text-white/80 border-white/10"
              asChild 
              data-testid="button-login"
            >
              <a href="/login">Sign In</a>
            </Button>
            <Button 
              className="bg-amber-500 text-zinc-950 border-amber-600 font-semibold uppercase tracking-wide" 
              asChild 
              data-testid="button-register"
            >
              <a href="/register">Get Started</a>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
          <div 
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${heroImage})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/60 via-zinc-950/80 to-zinc-950" />
          
          <div className="container relative z-10 px-4 md:px-6 py-32">
            <div className="flex flex-col items-center text-center max-w-4xl mx-auto space-y-8">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
                STATE OF THE ART{" "}
                <span className="text-amber-500">LOD 400</span>{" "}
                BIM SERVICES FROM{" "}
                <span className="text-amber-500">150 SAR</span>{" "}
                PER SHEET
              </h1>
              <p className="text-lg md:text-xl text-white/70 max-w-2xl">
                Professional LOD 300 to LOD 400 model upgrades for construction
                documentation. Upload directly from Revit and receive
                production-ready deliverables.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <Button 
                  size="lg" 
                  className="bg-amber-500 text-zinc-950 border-amber-600 font-bold uppercase tracking-wide text-base px-8"
                  asChild 
                  data-testid="button-get-started"
                >
                  <a href="#contact">
                    GET IN TOUCH NOW
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </a>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="bg-white/5 backdrop-blur-md border-white/20 text-white font-semibold uppercase tracking-wide"
                  asChild
                  data-testid="button-learn-more"
                >
                  <a href="#how-it-works">Learn More</a>
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-6 pt-8 text-sm text-white/60">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-amber-500" />
                  <span>150 SAR per sheet</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-amber-500" />
                  <span>Secure payment</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-amber-500" />
                  <span>Fast delivery</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 bg-zinc-900" id="features">
          <div className="container px-4 md:px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white">
                Why Choose <span className="text-amber-500">Us</span>
              </h2>
              <p className="text-white/60 max-w-2xl mx-auto text-lg">
                We specialize in delivering high-quality LOD 400 upgrades that
                meet construction and fabrication requirements.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {features.map((feature) => (
                <Card 
                  key={feature.title} 
                  className="bg-zinc-800/50 border-white/10 hover-elevate"
                >
                  <CardContent className="pt-8 pb-6">
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-amber-500/10 mb-6">
                      <feature.icon className="h-7 w-7 text-amber-500" />
                    </div>
                    <h3 className="font-semibold text-xl mb-3 text-white">{feature.title}</h3>
                    <p className="text-white/60">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-24 bg-zinc-950" id="how-it-works">
          <div className="container px-4 md:px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white">
                How It <span className="text-amber-500">Works</span>
              </h2>
              <p className="text-white/60 max-w-2xl mx-auto text-lg">
                A simple, streamlined process from order to delivery.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
              {steps.map((step, index) => (
                <div key={step.number} className="relative text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/30 mx-auto mb-6">
                    <step.icon className="h-8 w-8 text-amber-500" />
                  </div>
                  <div className="text-amber-500 font-bold text-sm mb-2 uppercase tracking-wide">
                    Step {step.number}
                  </div>
                  <h3 className="font-semibold text-xl mb-3 text-white">{step.title}</h3>
                  <p className="text-white/60">
                    {step.description}
                  </p>
                  {index < steps.length - 1 && (
                    <ArrowRight className="hidden lg:block absolute top-8 -right-4 h-6 w-6 text-amber-500/40" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-24 bg-zinc-900">
          <div className="container px-4 md:px-6">
            <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
              <div className="flex-1 text-center lg:text-left">
                <h2 className="text-3xl md:text-4xl font-bold mb-6 text-white">
                  Simple, Transparent{" "}
                  <span className="text-amber-500">Pricing</span>
                </h2>
                <p className="text-white/60 text-lg mb-8">
                  No hidden fees, no complicated tiers. Just straightforward pricing
                  for professional LOD 400 BIM model upgrades.
                </p>
                <div className="flex items-baseline gap-2 justify-center lg:justify-start mb-8">
                  <span className="text-6xl md:text-7xl font-bold text-amber-500">150</span>
                  <span className="text-2xl text-white/80">SAR</span>
                  <span className="text-xl text-white/60">/ sheet</span>
                </div>
                <ul className="space-y-4 text-left max-w-md mx-auto lg:mx-0">
                  <li className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                    <span className="text-white/80">Full LOD 400 upgrade with fabrication details</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                    <span className="text-white/80">Clash detection and resolution included</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                    <span className="text-white/80">Quality assurance review</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                    <span className="text-white/80">Secure file transfer and storage</span>
                  </li>
                </ul>
              </div>
              <div className="flex-1 w-full max-w-md">
                <Card className="bg-zinc-800/50 border-white/10 p-8">
                  <CardContent className="p-0 space-y-6">
                    <div className="text-center">
                      <h3 className="text-2xl font-bold text-white mb-2">Ready to Start?</h3>
                      <p className="text-white/60">Download our Revit add-in and begin upgrading your models today.</p>
                    </div>
                    <Button 
                      size="lg" 
                      className="w-full bg-amber-500 text-zinc-950 border-amber-600 font-bold uppercase tracking-wide"
                      asChild
                    >
                      <a href="/api/downloads/addin-compiled.zip" download>
                        <Download className="h-5 w-5 mr-2" />
                        Download Add-in
                      </a>
                    </Button>
                    <Button 
                      size="lg" 
                      variant="outline"
                      className="w-full bg-transparent border-white/20 text-white font-semibold uppercase tracking-wide"
                      asChild
                    >
                      <a href="/api/login">
                        Sign In to Dashboard
                        <ArrowRight className="ml-2 h-5 w-5" />
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 bg-zinc-950" id="contact">
          <div className="container px-4 md:px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white">
                Get In <span className="text-amber-500">Touch</span>
              </h2>
              <p className="text-white/60 max-w-2xl mx-auto text-lg">
                Have questions about our LOD 400 upgrade services? We're here to help.
              </p>
            </div>
            <div className="grid lg:grid-cols-2 gap-12 max-w-5xl mx-auto">
              <div>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-white">Name</Label>
                    <Input
                      id="name"
                      placeholder="Your name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                      className="bg-zinc-800 border-white/10 text-white placeholder:text-white/40"
                      data-testid="input-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-white">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="your@email.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                      className="bg-zinc-800 border-white/10 text-white placeholder:text-white/40"
                      data-testid="input-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="message" className="text-white">Message</Label>
                    <Textarea
                      id="message"
                      placeholder="Tell us about your project..."
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      required
                      rows={5}
                      className="bg-zinc-800 border-white/10 text-white placeholder:text-white/40 resize-none"
                      data-testid="input-message"
                    />
                  </div>
                  <Button 
                    type="submit" 
                    size="lg"
                    className="w-full bg-amber-500 text-zinc-950 border-amber-600 font-bold uppercase tracking-wide"
                    disabled={isSubmitting}
                    data-testid="button-submit"
                  >
                    {isSubmitting ? "Sending..." : "GET IN TOUCH NOW"}
                    {!isSubmitting && <ArrowRight className="ml-2 h-5 w-5" />}
                  </Button>
                </form>
              </div>
              <div className="space-y-8">
                <div>
                  <h3 className="text-xl font-semibold text-white mb-6">Contact Information</h3>
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-500/10">
                        <Mail className="h-5 w-5 text-amber-500" />
                      </div>
                      <div>
                        <p className="text-white/60 text-sm">Email</p>
                        <p className="text-white">info@lod400delivery.com</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-500/10">
                        <Phone className="h-5 w-5 text-amber-500" />
                      </div>
                      <div>
                        <p className="text-white/60 text-sm">Phone</p>
                        <p className="text-white">+966 50 123 4567</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-500/10">
                        <MapPin className="h-5 w-5 text-amber-500" />
                      </div>
                      <div>
                        <p className="text-white/60 text-sm">Location</p>
                        <p className="text-white">Riyadh, Saudi Arabia</p>
                      </div>
                    </div>
                  </div>
                </div>
                <Card className="bg-zinc-800/50 border-white/10 p-6">
                  <CardContent className="p-0">
                    <h4 className="font-semibold text-white mb-3">Business Hours</h4>
                    <div className="space-y-2 text-white/60">
                      <p>Sunday - Thursday: 9:00 AM - 6:00 PM</p>
                      <p>Friday - Saturday: Closed</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-12 bg-zinc-950">
        <div className="container px-4 md:px-6">
          <div className="grid md:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-500">
                  <Building2 className="h-5 w-5 text-zinc-950" />
                </div>
                <span className="font-semibold text-lg text-white">LOD 400 Delivery</span>
              </div>
              <p className="text-white/60">
                Professional BIM model upgrades for construction excellence. Transform your LOD 300 models to production-ready LOD 400.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Quick Links</h4>
              <ul className="space-y-2 text-white/60">
                <li><a href="#features" className="hover:text-amber-500 transition-colors">Features</a></li>
                <li><a href="#how-it-works" className="hover:text-amber-500 transition-colors">How It Works</a></li>
                <li><a href="#contact" className="hover:text-amber-500 transition-colors">Contact</a></li>
                <li><a href="/api/login" className="hover:text-amber-500 transition-colors">Sign In</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Services</h4>
              <ul className="space-y-2 text-white/60">
                <li>LOD 400 Model Upgrades</li>
                <li>Fabrication Documentation</li>
                <li>Clash Detection</li>
                <li>Quality Assurance</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-white/40">
              2024 LOD 400 Delivery Platform. All rights reserved.
            </p>
            <p className="text-sm text-white/40">
              Professional BIM model upgrades for construction excellence.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
