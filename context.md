# Role & Context
You are a Principal Software Architect and Lead Full-Stack Developer specializing in modern Web Development with Python (FastAPI/Django) and React (TypeScript/Tailwind CSS) along with android and ios app development.

You are tasked with building a custom **Tailored Clothing E-Commerce Web Application** that allows users to select design templates and submit custom body measurements for personalized garment fitting. every feature must support web, android and ios.

Memory setup:
Maintain a progress.md file to add progress and continue in another chats
Always check for issues.md & continue.md to resume where you left once things are done move the changes to progress and update these two files
And update conetxt.md on the technical stack & architectural guidelines

---

## Technical Stack & Architectural Guidelines

### 1. Architectural Philosophy (SOLID Principles)
* **Single Responsibility Principle (SRP):** Keep React components, API endpoints, database models, and service functions tightly focused on a single concern.
* **Open/Closed Principle (OCP):** Design domain models (e.g., measurement profiles, order state machines, design options) to be extendable without modifying core logic.
* **Liskov Substitution Principle (LSP):** Utilize interface contracts or protocols for payment gateways, notifications, and storage drivers.
* **Interface Segregation Principle (ISP):** Keep API responses and UI props small and specialized rather than dumping bloated global states into child components.
* **Dependency Inversion Principle (DIP):** Depend on abstractions (e.g., repository patterns in the Python backend, custom hook interfaces in React).

### 2. Stack Recommendations
* **Backend:** Python 3.11+ using **FastAPI** (Async, Pydantic v2, SQLAlchemy 2.0 ORM) or **Django REST Framework**.
* **Frontend:** React (Vite, TypeScript, Tailwind CSS, Lucide Icons, Shadcn UI / Radix UI).
* **State Management & Data Fetching:** React Query (TanStack Query) for API state, Zustand or Context API for local UI states (e.g., Theme Toggle).
* **Database:** PostgreSQL with JSONB support for flexible measurement attributes.

---

## Core System Requirements & Modules

### Module 1: Authentication & User Profiles
* **Auth:** Secure JWT-based authentication (Register, Login, Refresh tokens, OAuth option).
* **Profile Management:**
  * **User Account Details:** Basic profile info (Name, Email, Phone).
  * **Saved Delivery Addresses:** CRUD operations for multiple delivery addresses with a primary default flag.
  * **Liked Designs / Wishlist:** Toggle favorite status on designs.

### Module 2: Multi-Measurement Management (Core Feature)
* A single user account must be able to save **multiple measurement profiles** (e.g., "My Fit", "Brother - Shirt Fit", "Wife - Dress Fit").
* **Measurement Fields:** Categorized by gender and clothing category (e.g., Chest/Bust, Waist, Hip, Shoulder, Sleeve Length, Inseam, Neck, Height).
* **Validation:** Dynamic bounds-checking for logical measurement inputs in Python (Pydantic schema validation).

### Module 3: Home Page & Product Catalog
* Responsive Grid displaying clothing designs tailored for **Men** and **Women**.
* Filterable by category, gender, occasion, and fabric/style options.
* Product card features: High-res visual preview, starting price, customizable options badge, and quick-add to liked designs.

### Module 4: Tailoring Customization & Ordering Flow
* **Customization Builder:** Step-by-step garment order placement:
  1. Select Design
  2. Customize Details (Collar type, Cuff type, Fabric, Fit style, Special notes)
  3. Select or Add a Measurement Profile
  4. Select Delivery Address & Payment Method
* **Order Tracking & History:**
  * Real-time order status state machine (`Pending`, `Fabric Sourcing`, `Stitching In-Progress`, `Quality Check`, `Dispatched`, `Delivered`).
  * Order history view with full measurement snapshot saved at the time of order placement.

---

## UI/UX & Responsive Design Specifications

* **Dark/Light Mode (Reactive Black & White Palette):**
  * Implement high-contrast, clean minimalist aesthetic featuring dark mode (`#09090b` dark background, `#f4f4f5` text) and light mode (`#ffffff` light background, `#09090b` text).
  * System/manual preference toggle using CSS variables or Tailwind's `dark:` classes.
* **Layout Responsiveness:**
  * Mobile-first design for seamless navigation across phones, tablets, and desktop displays.
  * Grid layouts: 1-column on mobile, 2-column on tablet, 3/4-column on desktop (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`).
* **Interactivity:**
  * Optimistic UI updates for likes/wishlist.
  * Clear skeleton loaders and animated transition states.

---

## Implementation Steps Requested

1. **Database Schema & Domain Models:** Draft the PostgreSQL/SQLAlchemy schemas for Users, Addresses, MeasurementProfiles, Designs, Orders, and OrderItems.
2. **Backend API Contracts (FastAPI/Pydantic):** Write clean, modular router endpoints following REST best practices.
3. **Frontend Architecture:** Outline the React folder structure (`components/`, `hooks/`, `services/`, `context/`, `types/`).
4. **Theme Context:** Provide a clean React TypeScript implementation for the Reactive Light/Dark mode switcher.
5. **Key Component Code:** Deliver complete, typed TypeScript code snippets for the Home Page Design Grid, Measurement Profile Manager, and Order Flow.

---

## Current Vendor-Customer Architecture (2026-09-02)

- Vendor customers are represented by `vendor_customer_relationships`; account
  identity and role remain in `users`, so vendor-role users can also be customers.
- Relationship status is consent-aware: `invited`, `pending_acceptance`, `active`,
  or `declined`. Vendor-private notes are never part of the customer response.
- Vendor endpoints are rooted at `/api/vendor/customers` and always scope reads and
  writes by the authenticated vendor ID. Customer consent endpoints are rooted at
  `/api/customer/vendor-relationships` and scope by the authenticated customer ID.
- New-customer invitations reuse hashed, expiring `password_reset_tokens`; the raw
  token is sent only by transactional email. Successful password setup atomically
  activates the related invitation.
- PostgreSQL remains the concurrency authority through unique lower-case email,
  normalized phone, vendor/customer pair, and invitation-token constraints. API
  services translate integrity races into deterministic conflict/idempotent results.
- Schema changes are versioned in Alembic. Application startup checks the migration
  head and does not mutate production schema automatically.
- Git-triggered Cloud Run delivery uses `cloudbuild.yaml` to update and execute the
  `anu-tailoring-git-migrate` job with the commit image before updating the service.
  A failed migration therefore blocks deployment instead of surfacing as a port-8080
  startup failure.
- Product inventory follows its selling unit: `piece` stock is a non-negative whole
  number, while `metre` stock may be decimal. This invariant is enforced in Pydantic
  create/update contracts and mirrored by web/native input validation; price remains
  a separate decimal monetary field.
