# LOD 400 Delivery Platform

## Overview

The LOD 400 Delivery Platform is a professional B2B SaaS application designed to upgrade BIM (Building Information Modeling) models from LOD 300 to LOD 400 specifications. It offers a comprehensive workflow for clients to upload Revit models, process payments for upgrades, and receive production-ready detailed construction documents. The platform features a web dashboard for client and administrator management, alongside a seamless Autodesk Revit add-in integration.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript, utilizing Vite for bundling.
**UI Component Library**: shadcn/ui (Radix UI primitives) with Tailwind CSS, following a modern SaaS dashboard aesthetic.
**Routing**: wouter for client-side routing with role-based layouts.
**State Management**: TanStack Query for server state management, including authentication handling.
**Theming**: Dark/light mode via CSS variables and a custom ThemeProvider.
**Design Tokens**: Inter font, Tailwind spacing, HSL-based color system, standardized component designs.

### Backend Architecture

**Runtime**: Node.js with Express.js, bundled with esbuild.
**Language**: TypeScript (ES modules).
**API Design**: RESTful HTTP endpoints with role-based access control for orders, administration, payments, file downloads, and Revit add-in communication.
**Authentication**: Custom email/password authentication (replacing Replit Auth) with Passport.js, using session-based authentication stored in PostgreSQL.
**Authorization**: Role-based access control (`isAdmin` flag) with middleware protecting routes.
**File Uploads**: Uppy with AWS S3-compatible storage (Google Cloud Storage via Replit's Object Storage sidecar), supporting large files and resumable uploads.

### Data Storage Architecture

**Primary Database**: PostgreSQL (Neon serverless).
**ORM**: Drizzle ORM with a schema-first design.
**Database Schema**: Includes tables for `users`, `orders`, `files`, `orderSheets` (for individual sheet metadata), `addinSessions` (for Revit add-in authentication), and `sessions`.
**Session Storage**: PostgreSQL-backed sessions using `connect-pg-simple`.
**Object Storage**: Google Cloud Storage for file uploads/downloads, accessed via Replit's sidecar.

### Authentication & Authorization

**Web Authentication**: Custom email/password authentication, cookie-based sessions with PostgreSQL persistence, bcrypt hashing for passwords, 7-day session TTL with secure cookies.
**Revit Add-in Authentication**: Uses the same email/password credentials, returning a Bearer token for API calls, with session tokens stored as SHA-256 hashes and a 30-day expiry.
**Rate Limiting**: Implemented for login, registration, and password-related endpoints.
**Authorization Levels**: **Client** (order creation, file upload, view own orders) and **Admin** (full access to all orders, client, and file management).

### Payment Processing

**Payment Provider**: Stripe, integrated with `stripe-replit-sync` for webhook management.
**Payment Flow**: Client selects sheets, price calculated (150 SAR/sheet), Stripe Checkout Session created, payment confirmed via webhook updating order status.
**Webhook Handling**: Managed by `stripe-replit-sync` with custom handlers for order status updates.
**Price Configuration**: Centralized `PRICE_PER_SHEET_SAR` in `shared/schema.ts`.

### Revit Integration

**Revit Add-in**: C#/.NET Framework 4.8 application located in `/revit-addin`. Communicates via REST API with bearer token authentication. Handles sheet selection, model packaging, and upload progress. Supports Revit 2022, 2023, 2024. Includes PowerShell installer script.

## External Dependencies

### Third-Party Services

**Replit Infrastructure**: Object Storage (Google Cloud Storage sidecar), Connectors (Stripe credential management).
**Payment Processing**: Stripe, `stripe-replit-sync`.
**Database**: Neon Serverless PostgreSQL, `connect-pg-simple`.
**File Storage**: Google Cloud Storage (via Replit sidecar), `@uppy/aws-s3`.

### UI Component Libraries

**Radix UI Primitives** (via shadcn/ui): Dialog, Dropdown Menu, Popover, Toast, Tabs, Accordion, Alert Dialog, Checkbox, Radio Group, Navigation Menu, Sidebar, Command Menu.
**Utility Libraries**: Tailwind CSS, `class-variance-authority`, `clsx`, `tailwind-merge`, `date-fns`.

### Development Tools

**Build Pipeline**: Vite (frontend), esbuild (backend), TypeScript, Drizzle Kit (migrations).
**Code Quality**: PostCSS with Autoprefixer.