# LOD 400 Delivery Platform

## Overview

The LOD 400 Delivery Platform is a professional B2B SaaS application for upgrading BIM (Building Information Modeling) models from LOD 300 to LOD 400 specification. The platform provides a complete workflow for clients to upload Revit models, pay for upgrades (150 SAR per sheet), and receive production-ready detailed construction documents. The system includes both a web dashboard for clients and administrators, plus a Revit add-in for seamless integration with Autodesk Revit.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript, using Vite as the build tool and bundler.

**UI Component Library**: shadcn/ui (Radix UI primitives) with Tailwind CSS for styling. The design follows a modern SaaS dashboard pattern inspired by Linear, Vercel, and Stripe, prioritizing clarity and professional B2B aesthetics.

**Routing**: wouter for client-side routing with role-based layouts (admin vs. client dashboards).

**State Management**: TanStack Query (React Query) for server state management, with custom query client configuration for authentication handling.

**Theme System**: Dark/light mode theming using CSS variables and a custom ThemeProvider context.

**Design Tokens**: 
- Typography: Inter font family via Google Fonts CDN
- Spacing: Tailwind's consistent spacing scale (2, 4, 6, 8, 12, 16, 24)
- Colors: HSL-based color system with CSS variables for theme flexibility
- Components: Standardized card layouts, badges, buttons with hover elevation effects

### Backend Architecture

**Runtime**: Node.js with Express.js framework, built using esbuild for production.

**Language**: TypeScript (ES modules) for type safety across the stack.

**API Design**: RESTful HTTP endpoints with role-based access control:
- `/api/orders` - Client order management
- `/api/admin/*` - Administrative functions (orders, clients, file uploads)
- `/api/stripe/webhook` - Payment processing webhooks
- `/api/files/:id/download` - Secure file downloads

**Authentication**: Replit Auth (OpenID Connect) with Passport.js strategy. Session-based authentication using express-session with PostgreSQL session store.

**Authorization**: Role-based access control with `isAdmin` flag. Middleware functions (`isAuthenticated`, `isAdmin`) protect routes.

**File Uploads**: Uppy file uploader with AWS S3-compatible storage through Google Cloud Storage (via Replit's Object Storage sidecar). Large file support (up to 500MB) with multipart upload capability.

### Data Storage Architecture

**Primary Database**: PostgreSQL (via Neon serverless with WebSocket connection pooling).

**ORM**: Drizzle ORM with schema-first design approach. Schema co-located in `shared/schema.ts` for type sharing between client and server.

**Database Schema Design**:
- `users` - User profiles with Replit Auth integration (id, email, firstName, lastName, isAdmin)
- `orders` - Order records with status tracking (pending → paid → uploaded → processing → complete)
- `files` - File metadata and storage paths (type: input/output, orderId foreign key)
- `api_keys` - API authentication for Revit add-in (hashed keys, last used tracking)
- `sessions` - Session persistence for Replit Auth
- Stripe schema managed by stripe-replit-sync package

**Session Storage**: PostgreSQL-backed sessions using connect-pg-simple for reliable session persistence.

**Object Storage**: Google Cloud Storage for file uploads/downloads, accessed through Replit's sidecar authentication mechanism. Organized by environment-specific search paths.

### Authentication & Authorization

**User Authentication**: Replit Auth (OIDC) for web dashboard login with automatic user provisioning on first login.

**API Authentication**: Custom API key system for Revit add-in integration:
- API keys generated via web dashboard
- SHA-256 hashing for secure storage
- Bearer token validation on API endpoints
- Last-used timestamp tracking

**Session Management**: 7-day session TTL with httpOnly, secure cookies. PostgreSQL-backed session store for scalability.

**Authorization Levels**:
- **Client**: Can create orders, upload files, view own orders
- **Admin**: Full access to all orders, client management, file operations, order status updates

### Payment Processing

**Payment Provider**: Stripe with stripe-replit-sync for managed webhook handling.

**Payment Flow**:
1. Client selects sheets → price calculation (150 SAR per sheet)
2. Stripe Checkout Session creation with order metadata
3. Payment confirmation via webhook → order status update to "paid"
4. Automatic webhook endpoint creation and management

**Webhook Handling**: Managed webhooks through stripe-replit-sync package with automatic endpoint registration and signature verification. Custom handlers in `webhookHandlers.ts` for order status updates.

**Price Configuration**: Centralized in `shared/schema.ts` (PRICE_PER_SHEET_SAR = 150).

## External Dependencies

### Third-Party Services

**Replit Infrastructure**:
- Replit Auth (OIDC) - Authentication provider
- Replit Object Storage - File storage via Google Cloud Storage sidecar
- Replit Connectors - Stripe credential management

**Payment Processing**:
- Stripe - Payment gateway and checkout
- stripe-replit-sync - Webhook management and Stripe data synchronization

**Database**:
- Neon Serverless PostgreSQL - Primary database with WebSocket support
- connect-pg-simple - PostgreSQL session store adapter

**File Storage**:
- Google Cloud Storage - Object storage backend (via Replit sidecar)
- @uppy/aws-s3 - S3-compatible upload library

### UI Component Libraries

**Radix UI Primitives** (shadcn/ui foundation):
- Dialog, Dropdown Menu, Popover, Toast, Tabs
- Accordion, Alert Dialog, Checkbox, Radio Group
- Navigation Menu, Sidebar, Command Menu
- All primitives used with Tailwind CSS styling

**Utility Libraries**:
- Tailwind CSS - Utility-first styling
- class-variance-authority - Component variant management
- clsx + tailwind-merge - Conditional class merging
- date-fns - Date formatting and manipulation

### Development Tools

**Build Pipeline**:
- Vite - Frontend build tool and dev server
- esbuild - Server-side bundling for production
- TypeScript - Type checking across full stack
- Drizzle Kit - Database migrations and schema push

**Code Quality**:
- PostCSS with Autoprefixer - CSS processing
- Replit-specific plugins for dev environment integration

### Revit Integration

**Revit Add-in** (C#/.NET Framework 4.8):
- Located in `/revit-addin` directory
- Communicates with platform via REST API using API keys
- Handles sheet selection, model packaging, upload progress
- Supports Revit 2024 (adaptable for 2020-2025)

## Recent Changes

**December 3, 2025**:
- Added Downloads page for easy add-in distribution
- Created PowerShell installer script (Install-LOD400.ps1) for automated setup
- Updated App.cs to read API URL from config file for deployment flexibility
- Added Download Add-in button to landing page header
- Added Downloads link to sidebar navigation
- Clear documentation that Visual Studio compilation is required

**December 1, 2025**:
- Added complete API Keys management UI to Settings page
- Users can create, view, and delete API keys for Revit add-in authentication
- Keys are SHA-256 hashed in database with only prefix visible after creation
- Fixed Uppy CSS imports for v5.x compatibility (using subpath imports)
- State management improved for API key creation (proper reset before new creation)
- Clipboard error handling added for copy functionality

## MVP Completion Status

The LOD 400 Delivery Platform MVP is now complete with:

**Frontend**:
- Landing page with pricing and feature highlights
- User dashboard with order overview
- Order management with status tracking
- Admin dashboard for order processing
- API Keys management UI in Settings
- Dark/light theme support
- Responsive design

**Backend**:
- RESTful API with role-based access control
- Stripe payment integration with managed webhooks
- Object storage for file uploads/downloads
- API key authentication for Revit add-in
- Order lifecycle management

**Revit Add-in** (Source code distribution):
- Complete C# source code for Visual Studio compilation
- WPF dialogs for login, sheet selection, and status
- API key authentication
- Model packaging with workshared support
- Upload with progress tracking
- Payment flow via browser redirect
- Note: C# compilation not possible on Replit; users download source and compile in Visual Studio. PowerShell installer provides clear guidance when DLLs are missing.

**Tested Flows**:
- User registration and authentication (Replit OIDC)
- API key creation and validation
- Order creation and status tracking
- Payment processing via Stripe
- Admin file upload and order management