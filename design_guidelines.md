# Design Guidelines: LOD 400 BIM Services Platform

## Design Approach

**Dual-System Architecture**: Professional B2B marketing site (inspired by enterprise SaaS: Vercel, Linear, Stripe) + functional admin dashboard

**Rationale**: Marketing pages establish trust and credibility for engineering professionals with dramatic dark aesthetics; admin dashboard prioritizes workflow efficiency with clean, light interface.

## Core Design Elements

### A. Typography

**Font Stack**: Inter (Google Fonts CDN)
- **Marketing Headlines**: 700 weight, tight spacing (-0.03em)
  - Hero: text-5xl to text-6xl
  - Section headers: text-3xl to text-4xl
- **Dashboard/UI Text**: 
  - Headings: 600 weight, text-2xl to text-3xl
  - Body: 400 weight, text-base, line-height 1.6
  - Data/metrics: 500 weight
  - Labels: text-sm to text-xs
- **CTAs**: 600 weight, uppercase tracking-wide

### B. Layout System

**Spacing Primitives**: Tailwind units 4, 6, 8, 12, 16, 24, 32
- Marketing sections: py-24 to py-32 (desktop), py-12 to py-16 (mobile)
- Dashboard components: p-4 to p-6
- Card padding: p-6 to p-8
- Grid gaps: gap-8 to gap-12

**Container Strategy**:
- Marketing: max-w-7xl with px-6 to px-8
- Dashboard: Full-width with fixed sidebar (w-64)
- Forms: max-w-2xl centered

### C. Component Library

**Marketing Components**:

*Hero Section*:
- Full-viewport height (min-h-screen), hero image with dark gradient overlay (from transparent to black/90)
- Centered content with max-w-4xl
- Headline + subheadline + dual CTAs (primary: "GET IN TOUCH NOW", secondary: "View Pricing")
- Buttons with backdrop-blur-md backgrounds over images
- Trust indicator below CTAs: "Trusted by 50+ Engineering Firms"

*Feature Sections*:
- 3-column grid (grid-cols-1 md:grid-cols-3) with feature cards
- Each card: Large icon (w-12 h-12, gold accent), heading (text-xl), description, optional "Learn More" link
- Alternating dark/darker sections for visual rhythm

*Services Showcase*:
- 2-column layout (image left, content right, alternating)
- Large service images with subtle border glow
- Numbered list of capabilities with checkmarks
- "From 150 SAR/sheet" pricing highlight

*Social Proof*:
- Client logos grid (grid-cols-3 md:grid-cols-6, grayscale with hover color)
- Stats row: 4-column metrics (Projects Completed, Sheets Delivered, etc.)
- Testimonial cards with company info

*Contact/CTA Section*:
- Dark background with gradient accent
- Centered heading + description
- Contact form (2-column on desktop: form left, contact info right)
- Form fields: Name, Email, Company, Project Details (textarea), Sheet Count
- Prominent submit button

**Dashboard Components** (Light Theme):

*Sidebar Navigation*:
- Fixed left, logo top, nav items with icons (Heroicons)
- Active state: subtle background + left border accent
- Admin profile card bottom

*Stats Dashboard*:
- 4-column grid: Total Orders, Pending Payment, In Progress, Completed
- Each stat card: large number, label, trend indicator, icon

*Orders Table*:
- Columns: Order ID, Client, Sheets, Price, Status, Date, Actions
- Status badges: pill-shaped (Pending: amber, Paid: blue, Processing: purple, Complete: green)
- Row actions: View, Download, Upload, Mark Complete
- Striped rows with hover state

*File Management*:
- Drag-and-drop upload zone with dashed border
- Progress bars during upload
- File list with download/delete actions

*Order Detail Modal*:
- Overlay with backdrop-blur
- Card (max-w-3xl): Order summary, client info, file sections
- Status timeline: horizontal progress indicator
- Action buttons footer (right-aligned)

### D. Responsive Behavior

**Desktop (lg:)**: Multi-column layouts, fixed sidebar, full tables
**Tablet (md:)**: 2-column grids, collapsible sidebar
**Mobile (base)**: Single column, stacked cards, hamburger menu, simplified tables

### E. Visual Treatments

**Marketing (Dark Theme)**:
- Base: near-black backgrounds
- Accents: white text + gold highlights (#F59E0B range)
- Borders: subtle white/10 with glow effects
- Sections: alternating opacity backgrounds for depth

**Dashboard (Light Theme)**:
- Base: white/gray-50 backgrounds
- Borders: gray-200
- Hover states: gray-100
- Focus rings: blue accent

## Images

**Hero Section**: 
Large dramatic image of BIM/MEP engineering workspace - either modern architectural visualization, detailed Revit models, or professional engineer reviewing technical drawings on large monitors. Image should convey precision and expertise. Apply dark gradient overlay (from-transparent via-black/60 to-black/90) to ensure text readability.

**Service Showcase Images** (3-4 sections):
1. Detailed LOD 400 MEP model visualization
2. Before/after comparison of model upgrades
3. Team collaboration on BIM project
4. Technical drawing/clash detection screenshot

**Feature Section Icons**: 
Use Heroicons for features (DocumentCheck, CubeTransparent, ChartBar, ShieldCheck, etc.) - large size with gold accent color

**Dashboard**: 
Icon-only interface (no hero images). Use Heroicons throughout for navigation, file types, status indicators.

**Trust Elements**:
Industry certification badges/logos if applicable (Autodesk partner, etc.)

## Content Sections (Marketing Site)

1. **Hero**: Headline, subheadline, dual CTAs, trust indicator
2. **Services**: LOD 400 upgrade process, pricing highlight, capabilities
3. **Features**: 3-column grid (Fast Turnaround, Quality Assurance, Expert Team, Clash Detection, etc.)
4. **Process**: 4-step workflow visualization
5. **Social Proof**: Stats + client testimonials
6. **Pricing**: Clear 150 SAR/sheet highlight with what's included
7. **Contact/CTA**: Form + contact info + map/location
8. **Footer**: Quick links, services list, contact info, social links, newsletter signup