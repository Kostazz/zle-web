# ZLE - Czech Underground Skate Brand

## Overview

ZLE is a full-stack e-commerce web application for a Czech underground skateboard brand. The project features a React-based frontend with a raw, gritty aesthetic inspired by crew culture and street authenticity. The application includes a complete shopping experience with product catalog, shopping cart, checkout flow with Stripe payments, user authentication, admin dashboard, and email notifications.

The tech stack combines modern web technologies:
- **Frontend**: React with TypeScript, Vite build system, Wouter for routing
- **UI Framework**: shadcn/ui components with Radix UI primitives, Tailwind CSS
- **Backend**: Express.js REST API with session-based authentication
- **Database**: PostgreSQL with Drizzle ORM
- **Payments**: Stripe Checkout with webhooks for order confirmation
- **Email**: Resend for transactional emails (order confirmations, shipping updates)
- **State Management**: TanStack Query for server state, React Context for cart management

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Component Structure**
- Page-based routing using Wouter (`/`, `/shop`, `/story`, `/crew`, `/contact`, `/checkout`, `/orders`, `/addresses`, `/admin`)
- Shared layout system with persistent header, footer, background collage, and grain overlay
- Component hierarchy: Layout → Pages → Feature Components → UI Primitives
- shadcn/ui design system with custom theming for black & white aesthetic

**State Management**
- TanStack Query handles server state and API data fetching
- React Context (`CartProvider`) manages shopping cart state with localStorage persistence
- useAuth hook for authentication state
- Local component state for UI interactions (modals, drawers, form inputs)

**Styling Approach**
- Tailwind CSS utility-first styling with custom configuration
- Dark mode enforced across application
- Custom design tokens for grain effects, borders, and opacity levels
- Typography system using Inter, Archivo Black, and Montserrat fonts
- Heavy use of grayscale filters and grain textures for "underground" aesthetic

**Key Frontend Features**
- Photo grid with hover effects and parallax scrolling
- Product catalog with category filtering
- Stock indicators (sold out / low stock warnings)
- Shopping cart drawer with quantity management
- Product detail modals with size selection
- User authentication (login/logout via Replit Auth)
- Order history page
- Saved addresses management
- Admin dashboard (protected route)
- Responsive design with mobile-first approach
- Animations using CSS keyframes (fade-in, fade-in-up)

### Backend Architecture

**API Structure**
- RESTful Express.js server with JSON APIs
- Route handlers in `server/routes.ts`
- Session-based authentication via Replit Auth
- Protected routes with isAuthenticated middleware
- Admin routes with isAdmin middleware

**Public Endpoints**
- `GET /api/products` - Fetch all products
- `GET /api/products/:id` - Fetch single product
- `GET /api/products/category/:category` - Filter by category
- `POST /api/orders` - Create new order
- `GET /api/auth/user` - Get current user
- `GET /api/stripe/publishable-key` - Get Stripe public key
- `POST /api/stripe/create-checkout-session` - Create Stripe checkout
- `GET /api/checkout/verify` - Verify payment status

**Protected User Endpoints** (requires authentication)
- `GET /api/orders` - Get user's orders
- `GET /api/addresses` - Get user's addresses
- `POST /api/addresses` - Create address
- `PUT /api/addresses/:id` - Update address
- `DELETE /api/addresses/:id` - Delete address

**Admin Endpoints** (requires admin role)
- `GET /api/admin/stats` - Dashboard statistics
- `GET /api/admin/products` - All products with stock info
- `POST /api/admin/products` - Create product
- `PUT /api/admin/products/:id` - Update product
- `DELETE /api/admin/products/:id` - Delete product
- `PATCH /api/admin/products/:id/stock` - Update stock level
- `GET /api/admin/orders` - All orders
- `PATCH /api/admin/orders/:id` - Update order status
- `GET /api/admin/users` - All users
- `PATCH /api/admin/users/:id` - Update user (admin toggle)

**Data Layer**
- Drizzle ORM for database interactions
- Schema definitions in `shared/schema.ts` using PostgreSQL types
- Storage abstraction layer with `IStorage` interface
- Database migrations support via drizzle-kit

**Database Schema**
- **users**: id, username, password, isAdmin (for Replit Auth)
- **sessions**: sid, sess, expire (for session management)
- **products**: id, name, price, sizes[], image, images[], category, description, stock
- **orders**: id, customer details, items (JSON), total, status, paymentStatus, paymentIntentId, stripeSessionId, userId
- **addresses**: id, userId, name, address, city, zip, country, isDefault

**Email Service** (via Resend)
- Order confirmation emails sent on successful payment
- Shipping update emails sent when admin changes order status to shipped/delivered
- Templates styled to match ZLE brand aesthetic

**Request/Response Flow**
1. Client makes API request via TanStack Query
2. Express middleware parses JSON and logs requests
3. Auth middleware validates session if route is protected
4. Route handler validates input using Zod schemas
5. Storage layer interacts with database via Drizzle ORM
6. Response serialized as JSON and returned to client

**Webhook Flow (Stripe)**
1. Stripe sends webhook event to `/api/stripe/webhook/:uuid`
2. stripe-replit-sync verifies and processes event
3. checkout.session.completed triggers order update and confirmation email
4. Stock levels are updated after successful payment

**Build Process**
- Vite builds frontend to `dist/public`
- esbuild bundles server code to `dist/index.cjs`
- Production build combines both for single deployment artifact
- Development mode uses Vite dev server with HMR

### Design System

**ZLE Hybrid Style (H2)**
- Background layer: Black & white photo collage with heavy grain (10-25% opacity)
- Foreground layer: Clean white content blocks with high contrast
- No gradients or neon effects - pure black × white × grain aesthetic
- Typography: Bold, aggressive, all-caps headlines (700-900 weight)
- Component design emphasizes borders, frames, and whitespace separation

**Asset Organization**
- `/attached_assets/generated_images/` - Product photos, crew imagery, urban scenes
- All images processed with grayscale filters and grain overlays
- Parallax scrolling effects on background collage
- Lazy loading for performance optimization

### External Dependencies

**Third-Party UI Libraries**
- Radix UI primitives for accessible components (dialogs, dropdowns, sheets, tooltips, etc.)
- shadcn/ui component system built on Radix
- Embla Carousel for potential image galleries
- Lucide React for icon system

**Backend Services**
- Neon Database for serverless PostgreSQL
- Express sessions with connect-pg-simple for session storage
- Drizzle ORM for type-safe database queries
- Stripe for payment processing
- Resend for transactional emails

**Development Tools**
- Vite for frontend build and HMR
- esbuild for server bundling
- TypeScript for type safety across stack
- Replit-specific plugins for development environment integration

### Important Implementation Notes

**Stripe Integration**
- Uses stripe-replit-sync for managed webhooks
- Checkout sessions include orderId in metadata for tracking
- Payment verification endpoint retrieves session from Stripe API
- Webhook handlers update order status and trigger stock deduction

**Email Integration**
- Uses Resend via Replit Connectors for API key management
- Emails are sent asynchronously to not block main flow
- Templates use inline CSS for email client compatibility

**Admin Authentication**
- Users marked as admin via isAdmin flag in database
- isAdmin middleware checks user.isAdmin before allowing access
- Admin dashboard at /admin route protected on both frontend and backend
