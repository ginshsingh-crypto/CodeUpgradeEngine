# Design Guidelines: LOD 400 Delivery Platform

## Design Approach

**System Selection**: Modern SaaS Dashboard Pattern (inspired by Linear, Vercel, Stripe)

**Rationale**: This is a professional B2B utility application requiring clarity, efficiency, and trust. The design prioritizes information hierarchy, workflow optimization, and enterprise credibility over visual flair.

## Core Design Elements

### A. Typography

**Font Stack**: Inter (via Google Fonts CDN)
- **Headings**: 600 weight, tight letter-spacing (-0.02em)
  - Page titles: text-2xl to text-3xl
  - Section headers: text-lg to text-xl
- **Body**: 400 weight, comfortable line-height (1.6)
  - Primary text: text-base
  - Secondary/meta text: text-sm
  - Small labels: text-xs
- **Data/Numbers**: 500 weight (for order IDs, prices, counts)
- **Buttons/CTAs**: 500 weight, uppercase for primary actions

### B. Layout System

**Spacing Primitives**: Consistent use of Tailwind units: 2, 4, 6, 8, 12, 16, 24
- Component padding: p-4 to p-6
- Section spacing: space-y-6 to space-y-8
- Card internal spacing: p-6
- Form field gaps: space-y-4
- Button padding: px-4 py-2 (standard), px-6 py-3 (large)

**Container Strategy**:
- Admin dashboard: Full-width with sidebar (fixed 64 width on desktop)
- Content area: max-w-7xl with px-4 to px-8
- Forms/modals: max-w-2xl centered
- Tables: Full container width with horizontal scroll on mobile

### C. Component Library

**Navigation**:
- Fixed sidebar (desktop): Logo at top, navigation items with icons, admin info at bottom
- Mobile: Collapsible hamburger menu with overlay
- Top bar: Breadcrumbs, search (if needed), notifications icon, profile dropdown

**Dashboard Cards**:
- Stats cards: Grid layout (grid-cols-1 md:grid-cols-3), rounded-lg borders
- Each card: Icon (top-left), metric (large number), label (small text), trend indicator
- Subtle hover elevation (shadow-sm to shadow-md transition)

**Data Tables**:
- Striped rows for readability (alternating subtle backgrounds)
- Sticky header on scroll
- Row hover state (subtle background change)
- Status badges: Pill-shaped, color-coded (Pending: amber, Paid: blue, Complete: green)
- Actions column: Icon buttons (download, view, edit, delete)
- Pagination: Bottom-right, showing "1-10 of 234 results"

**Forms**:
- Full-width inputs with consistent height (h-10)
- Labels above inputs (text-sm, font-medium)
- Input states: default, focus (ring-2), error (red border), disabled (opacity-50)
- File upload: Drag-and-drop zone with dashed border, icon, and instructions
- Submit buttons: Right-aligned, primary style

**Modals/Overlays**:
- Centered overlay with backdrop (backdrop-blur-sm, bg-black/50)
- Card style: rounded-lg, max-w-lg to max-w-2xl
- Header with title and close button (X icon top-right)
- Content area with appropriate padding
- Footer with action buttons (Cancel left, Primary right)

**Buttons**:
- Primary: Solid fill, rounded-md, shadow-sm
- Secondary: Border style with transparent background
- Danger: Red variant for destructive actions
- Icon-only: Square aspect, centered icon
- Loading state: Spinner icon, disabled opacity

**Status Indicators**:
- Progress bars: Rounded-full, gradient fill showing percentage
- Loading spinners: Centered with optional text below
- Toast notifications: Top-right corner, slide-in animation, auto-dismiss

**Empty States**:
- Centered icon (large, muted)
- Heading and description text
- Primary action button below

### D. Application Structure

**Admin Dashboard Layout**:
1. **Sidebar** (fixed left, 64 units wide):
   - Logo/branding at top
   - Navigation links: Dashboard, Orders, Settings
   - Admin profile card at bottom
   
2. **Main Content Area**:
   - **Header Section**: Page title, optional action button (e.g., "New Order" - if manual creation needed)
   - **Stats Overview**: 4-column grid showing: Total Orders, Pending, In Progress, Completed
   - **Orders Table**: Filterable/sortable table with columns: Order ID, Client Email, Sheet Count, Price, Status, Upload Date, Actions
   - Each row action: View details, Download inputs, Upload outputs, Mark complete

3. **Order Detail View** (modal or dedicated page):
   - Order summary card (ID, date, status, price)
   - Client information section
   - Files section: Input files (download button), Output files (upload interface)
   - Status timeline showing: Created → Paid → Uploaded → Processing → Complete
   - Action buttons: Download all, Upload deliverables, Mark complete, Send notification

**File Management Interface**:
- Upload zone: Large, centered, with progress bar during upload
- File list: Name, size, upload date, download/delete actions
- Chunked upload progress: Real-time percentage indicator

**Payment/Order Flow** (what client sees - can be simple):
- Order confirmation page showing: Sheet count, total price, "Pay with Stripe" button
- Post-payment success page with order ID and status check link
- Order status page: Timeline view, file download when complete

### E. Trust & Professional Elements

- Security badges: "Secure Payment via Stripe" near checkout
- Professional email templates: Branded header, clear order details, prominent CTA
- Error handling: Friendly but informative messages, never raw errors
- Loading states: Always show progress, never leave users uncertain

### F. Responsive Behavior

**Desktop (lg:)**: Full sidebar, multi-column tables, 3-4 column stat grids
**Tablet (md:)**: Collapsible sidebar, 2-column grids, scrollable tables
**Mobile (base)**: Hidden sidebar (hamburger menu), single-column layouts, stacked cards, simplified table views with expandable rows

## Images

**No hero images required** - this is a functional dashboard application, not a marketing site. Use icons throughout for visual interest:
- **Dashboard icons**: Chart/graph icons for stats cards (from Heroicons)
- **File type icons**: Document/folder icons in file lists
- **Empty state illustrations**: Simple line-art style icons (large, centered)
- **Logo placeholder**: Top-left of sidebar (can be text-based initially)

Focus is on clarity and efficiency, not visual storytelling.