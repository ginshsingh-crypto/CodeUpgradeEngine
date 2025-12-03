# LOD 400 Delivery Platform

A professional B2B SaaS platform for upgrading Building Information Modeling (BIM) models from LOD 300 to LOD 400 specification. The platform provides a complete digital workflow where clients upload Revit models via a desktop add-in, pay securely through Stripe, and receive production-ready detailed construction documents.

## Features

### Web Dashboard
- **Client Portal**: Create orders, track progress, download deliverables
- **Admin Dashboard**: Manage orders, upload completed files, view analytics
- **Secure Authentication**: Login via Replit Auth (OpenID Connect)
- **Payment Processing**: Stripe integration with 150 SAR (~$40) per sheet pricing
- **Dark/Light Theme**: Modern UI with theme switching
- **API Key Management**: Generate keys for Revit add-in authentication

### Revit Add-in
- **Sheet Selection**: Browse and select specific sheets from your Revit model
- **Real-time Pricing**: See pricing before payment
- **Secure Upload**: Automatic model packaging with workshared support
- **Order Tracking**: Check status and download deliverables directly from Revit
- **API Key Auth**: Secure connection to platform using generated API keys

## Tech Stack

### Frontend
- **React** with TypeScript
- **Vite** for build tooling
- **Tailwind CSS** with shadcn/ui components
- **TanStack Query** for data fetching
- **wouter** for routing

### Backend
- **Node.js** with Express
- **TypeScript** (ES modules)
- **Drizzle ORM** with PostgreSQL
- **Passport.js** for authentication

### Infrastructure
- **PostgreSQL** (Neon Serverless) - Database
- **Google Cloud Storage** - File storage
- **Stripe** - Payment processing
- **Replit Auth** - User authentication

### Revit Add-in
- **C#** with .NET Framework 4.8
- **WPF** for user interface
- **Revit API** (2020-2025 compatible)

## Project Structure

```
├── client/                  # React frontend
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/           # Page components
│   │   ├── hooks/           # Custom React hooks
│   │   └── lib/             # Utility functions
│   └── index.html
├── server/                  # Express backend
│   ├── index.ts             # Server entry point
│   ├── routes.ts            # API routes
│   ├── storage.ts           # Database operations
│   └── auth.ts              # Authentication logic
├── shared/                  # Shared code
│   └── schema.ts            # Database schema & types
├── revit-addin/             # Revit add-in source
│   └── LOD400Uploader/      # C# project
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 18+ 
- PostgreSQL database
- Stripe account
- (For add-in) Visual Studio 2022 + Revit 2020-2025

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/lod400-platform.git
   cd lod400-platform
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env` file with:
   ```env
   DATABASE_URL=postgresql://user:password@host:5432/database
   SESSION_SECRET=your-secure-session-secret
   STRIPE_SECRET_KEY=sk_live_or_test_key
   STRIPE_PUBLISHABLE_KEY=pk_live_or_test_key
   ```

4. **Push database schema**
   ```bash
   npm run db:push
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

   The app will be available at `http://localhost:5000`

### Production Deployment

For production deployment on platforms like Replit, Railway, or Render:

1. Set all environment variables in your platform's dashboard
2. Build the application:
   ```bash
   npm run build
   ```
3. Start the production server:
   ```bash
   npm start
   ```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `SESSION_SECRET` | Secret for session encryption | Yes |
| `STRIPE_SECRET_KEY` | Stripe secret API key | Yes |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key | Yes |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | GCS bucket ID for file storage | For file uploads |

### Pricing Configuration

The price per sheet is configured in `shared/schema.ts`:

```typescript
export const PRICE_PER_SHEET_SAR = 150; // 150 SAR per sheet
```

## API Documentation

### Authentication

The platform uses two authentication methods:

1. **Web Dashboard**: Replit Auth (OIDC) with session cookies
2. **Revit Add-in**: API key authentication via Bearer token

### Client Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/orders` | List user's orders |
| POST | `/api/orders` | Create new order |
| GET | `/api/orders/:id` | Get order details |
| POST | `/api/orders/:id/checkout` | Create Stripe checkout |

### Add-in Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/addin/validate` | Validate API key |
| POST | `/api/addin/create-order` | Create order with sheets |
| GET | `/api/addin/orders` | List user orders |
| GET | `/api/addin/orders/:id/status` | Get order status |
| POST | `/api/addin/orders/:id/upload-url` | Get upload URL |
| POST | `/api/addin/orders/:id/upload-complete` | Mark upload complete |
| GET | `/api/addin/orders/:id/download-url` | Get download URL |

### Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/orders` | List all orders |
| PATCH | `/api/admin/orders/:id` | Update order status |
| GET | `/api/admin/clients` | List all clients |
| POST | `/api/admin/orders/:id/upload` | Upload deliverable |

## Revit Add-in Setup

### Option 1: Download from Website (Recommended)

1. Go to your published website
2. Sign in and navigate to **Downloads** page
3. Click **Download ZIP** to get the add-in package
4. Follow the on-screen installation instructions

### Option 2: Manual Setup

#### Step 1: Generate API Key

1. Log in to the web dashboard
2. Go to **Settings** → **API Keys**
3. Click the **+** button to create a new key
4. Copy and save the key (shown only once)

#### Step 2: Update Revit References

In `revit-addin/LOD400Uploader/LOD400Uploader.csproj`, update paths to match your Revit installation:

```xml
<Reference Include="RevitAPI">
    <HintPath>C:\Program Files\Autodesk\Revit 2024\RevitAPI.dll</HintPath>
</Reference>
<Reference Include="RevitAPIUI">
    <HintPath>C:\Program Files\Autodesk\Revit 2024\RevitAPIUI.dll</HintPath>
</Reference>
```

#### Step 3: Build

1. Open `LOD400Uploader.csproj` in Visual Studio 2022
2. Build in **Release** mode
3. Output will be in `bin\Release\net48\`

#### Step 4: Run the Installer

1. Copy the built DLLs (`LOD400Uploader.dll`, `Newtonsoft.Json.dll`) to the same folder as `Install-LOD400.ps1`
2. Right-click `Install-LOD400.ps1` → **Run with PowerShell**
3. Follow the prompts to select your Revit version
4. The installer will copy files to the correct Revit Addins folder

#### Step 5: Use

1. Restart Revit → find the **LOD 400** tab in the ribbon
2. Click **Upload Sheets**
3. Enter your API key when prompted
4. Select sheets, pay, and upload

## User Workflow

### Client Workflow

1. **Login**: Access web dashboard via Replit Auth
2. **Generate API Key**: Create key in Settings for add-in
3. **Open Revit**: Launch Revit with the add-in installed
4. **Enter API Key**: First-time login in add-in
5. **Select Sheets**: Choose sheets to upgrade
6. **Pay**: Complete Stripe checkout in browser
7. **Upload**: Add-in uploads model automatically
8. **Wait**: Admin processes the order
9. **Download**: Get completed deliverables

### Admin Workflow

1. **View Orders**: See incoming paid orders
2. **Download Input**: Get client's uploaded model
3. **Process**: Upgrade model to LOD 400
4. **Upload Output**: Upload completed files
5. **Mark Complete**: Update order status

## Database Schema

```typescript
// Users
users: {
  id: string,           // Replit user ID
  email: string,
  firstName: string,
  lastName: string,
  isAdmin: boolean
}

// Orders
orders: {
  id: serial,
  userId: string,
  sheetNames: string[],
  sheetCount: number,
  totalPrice: number,
  status: 'pending' | 'paid' | 'uploaded' | 'processing' | 'complete',
  stripeSessionId: string,
  createdAt: timestamp
}

// Files
files: {
  id: serial,
  orderId: number,
  filename: string,
  storagePath: string,
  type: 'input' | 'output',
  uploadedAt: timestamp
}

// API Keys
apiKeys: {
  id: serial,
  userId: string,
  name: string,
  keyHash: string,      // SHA-256 hash
  keyPrefix: string,    // First 8 chars for display
  lastUsedAt: timestamp,
  createdAt: timestamp
}
```

## Migrating to Other Platforms

This project uses standard technologies and can be deployed elsewhere:

### Database
- Export schema from `shared/schema.ts`
- Works with any PostgreSQL provider (Supabase, Railway, Render, AWS RDS)

### File Storage
- Replace GCS with any S3-compatible storage
- Update `server/storage.ts` with new provider

### Authentication
- Replace Replit Auth with:
  - Supabase Auth
  - Auth0
  - NextAuth.js
  - Custom JWT implementation

### Hosting
Compatible with:
- Vercel (serverless functions for API)
- Railway
- Render
- DigitalOcean App Platform
- AWS/GCP/Azure

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run db:push` | Push schema to database |
| `npm run db:studio` | Open Drizzle Studio |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is proprietary software. All rights reserved.

## Support

For technical support or questions, please contact the development team.

---

Built with Replit Agent
