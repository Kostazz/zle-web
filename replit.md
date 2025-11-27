# ZLE - Czech Underground Skate Brand

## Overview

ZLE is a full-stack e-commerce web application for a Czech underground skateboard brand. The project features a React-based frontend with a raw, gritty aesthetic inspired by crew culture and street authenticity. The application includes a complete shopping experience with product catalog, shopping cart, checkout flow, and brand storytelling sections.

The tech stack combines modern web technologies:
- **Frontend**: React with TypeScript, Vite build system, Wouter for routing
- **UI Framework**: shadcn/ui components with Radix UI primitives, Tailwind CSS
- **Backend**: Express.js REST API
- **Database**: PostgreSQL with Drizzle ORM
- **State Management**: TanStack Query for server state, React Context for cart management

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Component Structure**
- Page-based routing using Wouter (`/`, `/shop`, `/story`, `/crew`, `/contact`, `/checkout`)
- Shared layout system with persistent header, footer, background collage, and grain overlay
- Component hierarchy: Layout → Pages → Feature Components → UI Primitives
- shadcn/ui design system with custom theming for black & white aesthetic

**State Management**
- TanStack Query handles server state and API data fetching
- React Context (`CartProvider`) manages shopping cart state with localStorage persistence
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
- Shopping cart drawer with quantity management
- Product detail modals with size selection
- Responsive design with mobile-first approach
- Animations using CSS keyframes (fade-in, fade-in-up)

### Backend Architecture

**API Structure**
- RESTful Express.js server with JSON APIs
- Route handlers in `server/routes.ts`
- Endpoints:
  - `GET /api/products` - Fetch all products
  - `GET /api/products/:id` - Fetch single product
  - `GET /api/products/category/:category` - Filter by category
  - `POST /api/orders` - Create new order

**Data Layer**
- Drizzle ORM for database interactions
- Schema definitions in `shared/schema.ts` using PostgreSQL types
- Storage abstraction layer with `IStorage` interface
- In-memory storage implementation (`MemStorage`) for development
- Database migrations support via drizzle-kit

**Database Schema**
- **users**: id, username, password (for future authentication)
- **products**: id, name, price, sizes[], image, images[], category, description
- **orders**: id, customer details (name, email, address, city, zip), items (JSON), total, status

**Request/Response Flow**
1. Client makes API request via TanStack Query
2. Express middleware parses JSON and logs requests
3. Route handler validates input using Zod schemas
4. Storage layer interacts with database via Drizzle ORM
5. Response serialized as JSON and returned to client

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

**Development Tools**
- Vite for frontend build and HMR
- esbuild for server bundling
- TypeScript for type safety across stack
- Replit-specific plugins for development environment integration

**Potential Integrations** (not yet implemented)
- Payment processing (Stripe infrastructure present in dependencies)
- Email service (Nodemailer included)
- Authentication system (Passport.js available)
- File uploads (Multer configured)