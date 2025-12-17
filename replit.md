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
- `/api/addin/*` - Revit add-in endpoints (Bearer token auth)

**Authentication**: Replit Auth (OpenID Connect) with Passport.js strategy. Session-based authentication using express-session with PostgreSQL session store.

**Authorization**: Role-based access control with `isAdmin` flag. Middleware functions (`isAuthenticated`, `isAdmin`, `isAddinAuthenticated`) protect routes.

**File Uploads**: Uppy file uploader with AWS S3-compatible storage through Google Cloud Storage (via Replit's Object Storage sidecar). Large file support (up to 500MB) with multipart upload capability.

### Data Storage Architecture

**Primary Database**: PostgreSQL (via Neon serverless with WebSocket connection pooling).

**ORM**: Drizzle ORM with schema-first design approach. Schema co-located in `shared/schema.ts` for type sharing between client and server.

**Database Schema Design**:
- `users` - User profiles with Replit Auth integration (id, email, firstName, lastName, isAdmin, passwordHash)
- `orders` - Order records with status tracking (pending → paid → uploaded → processing → complete)
- `files` - File metadata and storage paths (type: input/output, orderId foreign key)
- `orderSheets` - Individual sheet metadata per order (sheetElementId, sheetNumber, sheetName) for dispute resolution
- `addinSessions` - Session tokens for Revit add-in authentication (SHA-256 hashed tokens)
- `sessions` - Session persistence for Replit Auth
- Stripe schema managed by stripe-replit-sync package

**Session Storage**: PostgreSQL-backed sessions using connect-pg-simple for reliable session persistence.

**Object Storage**: Google Cloud Storage for file uploads/downloads, accessed through Replit's sidecar authentication mechanism. Organized by environment-specific search paths.

### Authentication & Authorization

**Web Authentication** (Email/Password):
- Custom email/password authentication for clean sign-in experience (no OAuth consent screens)
- Users register with email, password, first name, last name
- Cookie-based sessions with PostgreSQL persistence (connect-pg-simple)
- Passwords hashed with bcrypt (cost factor 12)
- 7-day session TTL with httpOnly, secure cookies (sameSite: lax)
- Environment-aware secure cookie configuration (HTTPS required on Replit/production)

**Revit Add-in Authentication** (Email/Password + Bearer Token):
- Uses same email/password credentials as web dashboard
- Login returns Bearer token for API calls
- Session tokens stored as SHA-256 hashes for O(1) lookups
- 30-day session expiry for add-in tokens
- Sessions stored in dedicated `addinSessions` table

**Rate Limiting**:
- Login: 10 attempts per minute per IP+email combination
- Registration: 5 attempts per minute per IP
- Password endpoints: 20 attempts per minute per IP+userId

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
- Communicates with platform via REST API using email/password authentication (Bearer tokens)
- Default API URL: https://deepnewbim.com (configurable via config file or environment)
- Handles sheet selection, model packaging, upload progress
- Supports Revit 2024 (adaptable for 2020-2025)

## Recent Changes

**December 17, 2025 (V2 Enhancements - Resumable Uploads)**:
- Added GCS resumable upload support for large files (>50MB) with chunked transfer
- Server-side: `initiateResumableUpload()` and `checkResumableUploadStatus()` methods in ObjectStorageService
- New API endpoints: `POST /api/addin/orders/:orderId/resumable-upload` and `POST /api/addin/resumable-upload-status`
- Revit add-in: `UploadFileResumableAsync()` with 8MB chunk size and progress tracking
- `UploadSessionManager` class persists upload sessions to disk for resume capability after Revit restart
- Sessions expire after 7 days (GCS limit); expired sessions automatically cleaned up
- BackgroundUploader automatically chooses resumable vs simple upload based on file size

**December 17, 2025 (V2 Enhancements - Sheet Metadata)**:
- Added `orderSheets` table to store individual sheet metadata (sheetElementId, sheetNumber, sheetName) per order for dispute resolution and audit trail
- Updated API endpoints (web and Revit add-in) to accept and persist sheets array with order creation
- Frontend OrderDetailModal now displays scrollable list of selected sheets with number and name
- Revit add-in sends sheet details with order creation for server-side storage
- Added memory warning in Revit add-in before packaging (warns if < 2GB available RAM)
- Uses Microsoft.VisualBasic.Devices.ComputerInfo.AvailablePhysicalMemory for accurate system memory detection

**December 6, 2025**:
- **BREAKING**: Replaced Replit Auth with custom email/password authentication for web dashboard
  - Clean sign-in experience without OAuth consent screens
  - Added /login and /register pages with dark theme matching landing page
  - Added POST /api/auth/web-login endpoint for cookie-based sessions
  - Updated POST /api/auth/register to auto-login after registration
  - Environment-aware secure cookies (HTTPS on Replit/production, HTTP for local dev)
- Updated all protected routes to use session-based auth (req.dbUser)
- Removed Replit Auth login button from landing page, replaced with Sign In/Get Started buttons
- E2E tests verified: registration, login, logout, session persistence

**December 5, 2025 (Late)**:
- Simplified Revit add-in for pre-launch TEST_MODE:
  - Removed "Check Status" button entirely from ribbon
  - Removed StatusDialog.xaml and CheckStatusCommand.cs
  - Simplified UploadDialog: removed pricing display, changed button to "Upload"
  - Add-in now has single "Select Sheets" button for minimal UI
- TEST_MODE server behavior: returns `checkoutUrl: null` and marks orders as "paid" immediately
- Server logs "TEST MODE ACTIVE - Payments are bypassed" on startup

**December 5, 2025**:
- **BREAKING**: Removed all API key authentication - email/password is now the only authentication method for the Revit add-in
- Removed API key endpoints from server (/api/user/api-keys)
- Removed API Keys UI from Settings page
- Simplified isAddinAuthenticated middleware to only accept Bearer tokens
- Updated Revit add-in ApiService.cs to remove all API key methods
- Simplified LoginDialog.xaml.cs to remove legacy API key validation
- Fixed Uppy v5 compatibility: changed uppy.close() to uppy.destroy() in ObjectUploader
- Fixed broken download link in ClientDashboard (now points to /downloads page)
- Updated default API URL in Revit add-in to https://deepnewbim.com
- All E2E tests passing: client flow, admin flow, order lifecycle

**December 4, 2025**:
- Redesigned landing page with dark theme matching newbim.info aesthetic
- Added gold/amber accents, hero section with stock image, feature sections
- Implemented complete password-based authentication system for Revit add-in
- Added addinSessions table with SHA-256 token hashing for O(1) lookups
- Added rate limiting: IP+email for login (10/min), IP-only for registration (5/min), IP+userId for password endpoints (20/min)
- Settings page now includes password management UI for add-in access

**December 3, 2025**:
- Added Downloads page for easy add-in distribution
- Created PowerShell installer script (Install-LOD400.ps1) for automated setup
- Updated App.cs to read API URL from config file for deployment flexibility
- Added Download Add-in button to landing page header
- Added Downloads link to sidebar navigation

## MVP Completion Status

The LOD 400 Delivery Platform MVP is now complete with:

**Frontend**:
- Landing page with pricing and feature highlights
- User dashboard with order overview
- Order management with status tracking
- Admin dashboard for order processing
- Password management UI in Settings for add-in login
- Dark/light theme support
- Responsive design

**Backend**:
- RESTful API with role-based access control
- Stripe payment integration with managed webhooks
- Object storage for file uploads/downloads
- Email/password authentication for Revit add-in (Bearer tokens)
- Order lifecycle management

**Revit Add-in** (Source code distribution):
- Complete C# source code for Visual Studio compilation
- WPF dialogs for login, sheet selection, and status
- Email/password authentication (Bearer token)
- Model packaging with workshared support
- Upload with progress tracking
- Payment flow via browser redirect
- Note: C# compilation not possible on Replit; users download source and compile in Visual Studio. PowerShell installer provides clear guidance when DLLs are missing.

**Tested Flows**:
- User registration and authentication (email/password)
- Session-based web authentication with secure cookies
- Password-based add-in login (Bearer tokens)
- Order creation and status tracking
- Payment processing via Stripe
- Admin file upload and order management
