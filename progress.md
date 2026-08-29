# Vastrivo — Progress

Last updated: 2026-08-08

## Current milestone

The multi-vendor marketplace now covers design publishing plus the first
customer/vendor order-invoice workflow across React, FastAPI, and PostgreSQL.

### Distance-based delivery management (2026-08-02)

- Removed delivery-price entry from the vendor invoice. Vendor invoices now
  contain tailoring, cloth, and agreed additional products only.
- Added backend-only Google Maps Platform integration:
  - Geocoding verifies administrator-managed vendor pickup addresses and saved
    customer delivery addresses.
  - Routes API Compute Route Matrix supplies driving distance and duration.
  - Coordinates are refreshed after 29 days while Google Place IDs are retained.
- Added one delivery record per order/vendor so a multi-design order does not
  charge the same vendor route repeatedly.
- Delivery cost is calculated as every started 100-metre block multiplied by
  the administrator's configured price per 0.1 km.
- Added a signed 10-minute delivery quote to reuse the checkout route result
  securely when the order is placed, avoiding a duplicate Google API call.
- Added a Delivery administration screen with provider name, communication
  email/phone/details, activation, price-per-100m control, route summaries,
  delivery filtering, status updates, tracking numbers/URLs, provider
  references, and internal notes.
- Super admins control provider and pricing settings; admins can operate and
  track deliveries. Customer and vendor order details show the calculated
  distance, charge, provider, current status, and tracking link.
- Google Maps credentials remain server-only through the ignored `.env` locally
  and Secret Manager on Cloud Run. React never calls Google services directly.
- Added startup compatibility for vendor/customer coordinates and new delivery
  tables/indexes, plus `scripts/verify_delivery_management.py`.

### UI and UX refinement (2026-08-01)

- Added a persistent, role-aware mobile navigation bar so customers, vendors,
  and administrators can reach their primary destinations without opening a
  temporary menu.
- Added an accessible skip link, consistent keyboard focus indicators, route-
  specific browser titles, clearer role names, relative notification times,
  and Escape-key handling for header popovers.
- Upgraded every shared modal with initial focus, focus containment, Escape and
  backdrop dismissal, background scroll locking, labelled descriptions, and
  focus restoration when the dialog closes.
- Added a reusable confirmation dialog and applied it to payment approval,
  payment verification, cloth receipt, tailoring start, and administrator order
  status changes to prevent accidental financial or workflow actions.
- Added an order progress tracker that explains the current stage across vendor
  quote, customer approval, cloth readiness, and tailoring.
- Improved registration with independent password visibility controls, live
  password requirement feedback, and an immediate password-match state.
- Clarified that order search filters the currently loaded page, and renamed the
  administrator status action to make its consequence clearer.
- Fixed small-screen authentication sizing, desktop authentication overflow,
  and shared loading-spinner alignment. Public authentication screens were
  visually checked in light and dark themes at desktop and mobile sizes.

### Performance and security hardening (2026-08-01)

- Replaced unbounded order-list responses with paginated customer, vendor, and
  administrator APIs (20 rows per UI request, backend maximum 100) and added a
  load-more control that reports loaded and total order counts.
- Removed order-creation N+1 queries: all requested designs and measurement
  profiles are now fetched in two bounded queries, with ownership, approval,
  and active-vendor checks applied before the transaction is written.
- Vendor order queries now load only that vendor's items, preventing unrelated
  marketplace items from entering memory or an accidental response.
- Added PostgreSQL indexes for the hot order, item, comment, notification, and
  vendor-design list paths. Startup compatibility creates them on existing DBs.
- Added row locks around invoice/payment/cloth/job state transitions and invoice
  revision checks so double-clicks or stale browser tabs cannot silently repeat
  or overwrite workflow actions.
- Tightened invoice input to two decimal places, capped variable invoice charges,
  rounded calculated totals, restricted payment-reference characters, and
  sanitized uploaded proof filenames.
- Private GCS image and cloth-bill responses now use opaque ETags and private
  cache validators, avoiding repeat bucket downloads while retaining an
  authenticated backend authorization check.
- JWTs now validate issuer and audience and include issued-at metadata. Unknown
  login emails still perform a password hash verification to reduce timing-based
  account enumeration.
- Access tokens moved from persistent local storage to per-tab session storage.
  Proactive refresh runs only for a visible, recently active UI; closing the tab
  no longer leaves a reusable JavaScript token behind.
- Active device sessions are capped at five per user, expired sessions are
  cleaned up, authentication responses are non-cacheable, and production gets
  HSTS, CSP, frame, MIME, referrer, and browser-permission security headers.
- Shared current-user requests are cached/deduplicated in the UI. Notification
  polling no longer restarts on navigation, pauses in hidden tabs, prevents
  overlapping requests, and refreshes on return to the tab.

### Vendor order and invoice milestone (2026-08-01)

- Rebuilt the shared Order Centre around explicit expandable order cards, so
  vendors, customers, and administrators can open each order and inspect every
  design, selected measurement snapshot, customer note, and delivery address.
- Clarified marketplace pricing throughout the catalog, design details,
  checkout, vendor workspace, and orders: a design's base price is the
  tailoring service charge only, not the complete job cost.
- Added a per-order-item vendor invoice workflow with printable invoice layout:
  - Tailoring service price is carried into the invoice and is read-only.
  - Vendor separately enters delivery cost and, when applicable, cloth cost.
  - Vendor must always specify cloth type and a detailed cloth requirement
    based on the selected measurements, including when the customer supplies it.
  - Invoice drafts stay private until the vendor sends them; issued/approved
    invoices cannot be silently edited. Customers can approve or request
    changes with a comment.
- Added both cloth fulfilment paths:
  - Vendor-supplied cloth with a cost requires customer invoice approval,
    payment-reference submission, and vendor payment verification before work.
  - Customer-supplied cloth has zero cloth cost and requires vendor confirmation
    that the cloth was received before work.
  - The backend enforces every approval/payment/cloth gate before the vendor can
    start the tailoring job.
- Added an order conversation shared by the related customer, vendor, and
  administrators, with notifications sent to the other party.
- Added persisted `vendor_invoices`, `order_comments`, and per-item work status,
  plus startup compatibility for existing local databases.
- Added `scripts/verify_order_invoice.py`, a rollback-only live database
  regression test covering vendor-supplied and customer-supplied cloth flows.
- Fixed stale SQLAlchemy relationship caching found by the regression test, so
  a newly created invoice is immediately available to the send/approval steps.
- Customer now selects `vendor_supplied` or `customer_provided` cloth while
  placing each design order. The choice is persisted on the order item and is
  read-only for the vendor.
- Vendor invoice drafts now support up to 25 additional itemized product/cost
  rows with name, optional description, quantity, unit price, row total, and an
  additional-items subtotal included in the invoice total.
- Vendor-supplied cloth invoices now support one private cloth-bill proof:
  - Vendor uploads a PDF, JPEG, PNG, or WebP file up to 5 MB after invoice approval.
  - The browser uploads only to FastAPI; FastAPI validates and stores the proof
    under `vendors/{vendor_id}/orders/{order_id}/invoices/{invoice_id}/cloth-bills/`.
  - Only the related customer/vendor or an administrator can read the file
    through the authenticated backend proxy; bucket and object details stay private.
  - The customer cannot submit a cloth payment reference until proof is attached.
  - Replacing proof updates the invoice and best-effort deletes the old bucket object.
- Startup compatibility now adds the customer cloth decision and proof metadata
  to existing databases; normalized invoice line-item storage is created automatically.

### Multi-vendor marketplace milestone (2026-07-31)

- Added `customer`, `vendor`, `admin`, and `super_admin` roles.
  - Public registration always creates customers.
  - The configured seeded account is promoted to super admin on startup.
  - Admins create vendor accounts after verification; email and phone uniqueness
    and password-strength rules are reused.
- Added vendor-owned design lifecycle: `draft`, `submitted`, `approved`, and
  `rejected`.
- Added a responsive Vendor Workspace:
  - Create and edit design details.
  - Upload 1–10 JPEG, PNG, or WebP images, up to 5 MB each.
  - Search/filter the collection and preview images in a reusable full-screen
    zoom viewer with keyboard controls and focus containment.
  - Published designs can be revised; the first detail/image change safely moves
    the design back to draft for reapproval instead of changing live content.
  - See draft/submitted/approved/rejected totals and reviewer feedback.
  - Submit designs for approval and delete owned designs.
- Added an Administration workspace:
  - Search and filter submitted designs and open images in a zoomable lightbox.
  - Approve and publish or reject with a required reason.
  - Search/filter vendor and customer directories and create vendor accounts.
  - Super admins can edit non-email profile fields, activate/deactivate accounts,
    and delete accounts that have no protected design/order history.
  - Regular admins retain approval and read-only directory access.
- Added persisted `is_active` account status. Inactive accounts cannot log in,
  refresh sessions, or continue using an existing access token.
- Added persisted notifications with an unread badge/popover, mark-one-read, and
  mark-all-read flows. Admins are notified on submission; vendors are notified
  on approval/rejection.
- Added durable Google Cloud Storage integration:
  - The private bucket is configured only through `GCS_BUCKET_NAME`; real cloud
    resource names remain outside tracked files.
  - Final objects use `vendors/{vendor_id}/designs/{design_id}/{image}`.
  - Local ADC automatically impersonates the runtime service account configured
    only in the ignored `.env`; no credential keys are stored in the repository.
  - The browser communicates only with FastAPI. The backend validates and
    uploads image bytes to GCS and proxies authorized image reads.
  - PostgreSQL stores bucket/object keys and upload metadata.
  - Upload validation enforces MIME type, matching file signatures, a 5 MB size
    limit, and at most 10 images per design before storage.
  - Deleting an image or design deletes its bucket objects first; missing
    objects are handled idempotently.
  - Designs referenced by an order cannot be deleted.
- Public design and favorite APIs now return approved designs only.
- Orders reject designs that are not approved.
- Added startup compatibility updates for role and design moderation columns;
  new image, review-history, and notification tables are created automatically.
- Added GCS configuration to `.env.example`, Cloud Run deployment variables,
  and one-time GCP IAM/bucket instructions.
- Replaced signed browser upload/read URLs with backend-only GCS integration.
  Failed storage writes do not create database image records, and failed
  database commits trigger compensating bucket cleanup.
- Cloud Storage authentication and IAM failures now produce actionable popup
  messages. Login credential failures retain the backend's specific error
  instead of being mislabeled as an expired session.
- Registration now explains that vendor access is reviewed separately and shows
  the temporary contact address `vendors@vastrivo.com`.

### Completed

- Reorganized the customer Order Centre into three responsive views:
  **In progress**, **Completed**, and **Cancelled / rejected**, consistently
  grouping both tailoring and shop orders. Wishlist remains in the main design
  catalog and is intentionally separate from orders. Vendor/admin operational
  order filtering is unchanged.
- Renamed the per-item order conversation to **Order chat** and added secured,
  incremental five-second refresh while an expanded order is open. Messages
  remain persisted, notify the other party, pause polling in background tabs,
  and recover automatically after temporary request failures.
- Added guarded tailoring-order cancellation and vendor rejection:
  - Customers can cancel an entire tailoring order before any vendor invoice is
    accepted; the reason is required, stored in each item conversation, and
    sent to affected vendors.
  - Vendors can reject only their own design item before its invoice is
    accepted, with a required reason. Multi-vendor order data remains private.
  - Rejected/cancelled items remain visible for audit history but are removed
    from active totals and cannot continue through invoice or tailoring steps.
  - The affected delivery is cancelled when a vendor has no remaining active
    items; full customer cancellation closes all deliveries.
  - Backend enforcement prevents customers, vendors, and administrators from
    cancelling after invoice approval, and cancelled orders cannot be reopened.
  - Rollback-only workflow coverage verifies both allowed paths and the
    invoice-acceptance cancellation lock.
- Added a moderated vendor shop for physical clothing and fabric sales:
  - Vendors can create ready-made or fabric product drafts with category,
    garment/fabric style, price per piece/metre, available stock, optional
    sizes and colours, and 1–10 private images up to 5 MB each.
  - Product images use the same backend-only private GCS integration under
    `vendors/{vendor_id}/products/{product_id}/`; deleting an unreferenced
    product removes its bucket objects, while ordered products are retained.
  - Editing an approved product returns it to draft; vendors submit products
    to a separate Admin shop queue, where admins approve or reject with a
    required reason. Vendors receive status notifications.
  - Customers can search/filter approved in-stock products, browse and zoom
    every image, choose quantity/size/colour/address, request the automatic
    Google Maps delivery quote, see a product + delivery total, and order.
  - Checkout locks the product row, validates the signed delivery quote and
    selected variants, reserves stock transactionally, and rejects stale or
    insufficient-stock requests.
  - Customer, vendor, and admin Order Centre views now include shop orders.
    Customers can cancel newly placed orders; vendors/admins progress them
    through confirmed, packed, shipped, and delivered states. Cancellation
    restores stock, and shipping/delivery updates the linked delivery record.
  - Admin Delivery Management distinguishes shop orders from tailoring orders.
  - Added live schema/API smoke coverage in
    `scripts/verify_product_shop.py`.
- Responsive login screen with Vastrivo brand mark, icons, password visibility control, loading/error feedback, and light/dark themes.
- Login accepts existing passwords without applying registration-length rules;
  password-strength validation remains limited to account creation.
- Registration screen updated to the same design language.
- Registration fields use account-creation autocomplete hints so saved login
  credentials are not loaded into a new-user form.
- User creation requires a valid phone number and enforces unique email and
  phone values in both the API and PostgreSQL. Email comparison is
  case-insensitive, and Indian `+91` phone formatting is normalized.
- Successful login now opens the authenticated design catalog at `/`.
- Empty catalog and empty favorites states are implemented for the current no-data case.
- Catalog supports search, women/men filters, and a favorites-only view.
- Design favorites use the existing persisted backend APIs with optimistic UI updates.
- Catalog cards now browse every published design image with previous/next controls and an image counter.
- Customers can open a design from its image, title, or action link into a responsive detail gallery with scrollable thumbnails, vendor information, pricing, favorites, and full-screen zoom.
- Customers can place a made-to-measure order from a published design using a saved measurement profile and delivery address, then track all orders from the shared Order Centre.
- Vendors have a privacy-scoped order view containing only items from their own designs, with customer, fit, instructions, and delivery information needed for fulfilment. Vendors receive a notification when an order is placed.
- Admins can search/filter every order, update its fulfilment status and tracking number, and automatically notify the customer about status changes.
- Admins can create, edit, activate/deactivate, and delete configurable measurement categories, including customer-facing fields and optional standard-size presets. Customer measurement forms now load these definitions from the backend and can prefill an editable standard size.
- Filter dropdowns now share a consistent themed control across catalog workspaces, administration, checkout, and orders.
- Profile & Settings received a clearer tailoring-focused introduction, summary cards, improved section language, and refined typography/layout.
- Authenticated header includes a profile dropdown with **Profile & settings** and **Log out**.
- Profile page includes:
  - Editable name, phone number, and location.
  - Read-only email.
  - Multiple named measurement profiles.
  - Women’s garment presets: saree blouse, salwar/kameez, lehenga, kurta, dress/gown.
  - Men’s garment presets: kurta, shirt, trouser/pyjama, sherwani.
  - Garment-specific measurement fields, inches/cm, fit notes, and create/edit/delete actions.
  - Multiple delivery addresses, default-address handling, and create/edit/delete actions.
- Session expiry clears browser-session tokens and returns the customer to sign-in.
- Authentication now uses 10-minute access tokens and rotating 30-minute refresh
  sessions. Refresh tokens are stored only in an `HttpOnly`, `SameSite=Strict`
  cookie (`Secure` in production), automatically rotated while the UI is active,
  and never returned to or stored by JavaScript. Logout revokes the persisted
  server session immediately, so already-issued access tokens are rejected.
- Backend additions:
  - `User.location`.
  - `PUT /api/auth/me` for editable profile fields.
  - Flexible JSONB garment measurements plus `garment_type`.
  - Safe startup compatibility updates for existing development databases.
  - Fixed `/api/designs/liked/me` route ordering so it is not captured as a design ID.
  - Order snapshots now include garment type and flexible measurement values.
- Local development now has one Windows entry point:
  - `start-dev.cmd` sets up missing dependencies and starts React plus FastAPI together.
  - Root `npm run dev` and `npm run setup` aliases are also available.
  - `README.md` documents combined and separate startup steps.
  - Windows `.cmd` executables are launched through `cmd.exe` to avoid Node
    `spawnSync ... EINVAL` errors for `npm.cmd` and `gcloud.cmd`.
  - Combined development logs are explicitly streamed with `[backend]` and
    `[frontend]` prefixes; FastAPI access logging and unbuffered output are enabled.
- GCP deployment groundwork is included:
  - A multi-stage `Dockerfile` builds React and serves it through FastAPI.
  - Production uses Cloud Run's injected `PORT` and one public container.
  - `DATABASE_URL` can target Cloud SQL without changing local PostgreSQL settings.
  - `.env` is excluded from Docker and gcloud source uploads.
  - `deploy-gcp.cmd` / `npm run deploy:gcp` provide repeatable Cloud Run source deployments.
- Vendor purchasing and sales workspaces are now separated cleanly:
  - Vendors can buy published designs, clothes, and fabric from other vendors.
  - Backend ownership checks reject attempts to buy a vendor's own design or product.
  - `/orders` is the vendor's personal purchase history and uses the same
    in-progress/completed/cancelled views as a customer account.
  - `/vendor/sales-orders` is the separate fulfilment workspace for tailoring
    and shop orders placed with that vendor, with dedicated desktop and mobile navigation.
  - Invoice, rejection, payment, cancellation, notification, and fulfilment
    controls are based on order ownership rather than the account role alone.
- Vendor product creation UI was redesigned into compact listing, pricing and
  inventory, and customer-option sections. It now has clearer required fields,
  option chips, responsive columns, and a sticky Cancel/Create action bar.
  - Vendors can now select and preview 1–10 product images directly while
    creating or editing a listing; files remain limited to JPEG/PNG/WebP and
    5 MB each, and all uploads continue through the authenticated backend.
  - The editor offers **Save draft** and **Save & submit**. Submission sends
    product details and images to the existing administrator approval queue;
    the product is not published until approved, and later image edits return
    an approved product to draft for re-verification.
- Increased the inner spacing around the vendor invoice creation prompt so its
  content and action no longer touch the expanded order-card edges.
- Order chat is WebSocket-first:
  - Browser clients exchange their access token for a 30-second ticket bound to
    one order item; access tokens are never placed in the socket URL.
  - Messages remain persisted in PostgreSQL and the connection automatically
    reconnects and resumes after the latest received message.
  - Active sessions and order ownership are checked on the backend, and logout
    invalidates a connected chat shortly afterwards.
  - Vite proxies WebSocket upgrades locally; the Cloud Run deployment command
    configures a 60-minute request timeout and best-effort session affinity.
  - Chat presentation now uses readable 14px message text, content-sized
    customer/vendor bubbles, clearer sender-role-time metadata, a larger
    conversation viewport, and a responsive composer in both themes.

## Measurement reference notes

The presets follow Indian vocational tailoring material rather than one universal body-size chart. The UI intentionally stores body measurements by garment because a saree blouse, kameez, kurta, and trouser require different dimensions.

- INFLIBNET basic kameez material: bust, waist, hip, shoulder, garment length, sleeve length/round, neck and torso-related dimensions.
- Bharat Skills men’s-wear material: chest, waist, hip, shoulder, neck, bicep, sleeve, shirt length, thigh, and outseam.
- Bharat Skills dressmaking material: natural waist, full length, shoulder, sleeve, bust/chest, hip, neck, inner/outer leg, rise, knee and bottom round.

## Product detail reference refinement

- Reworked the shop product dialog around the reviewed UI Design Daily product-info reference while retaining Vastrivo's warm editorial theme.
- Added a larger image-led gallery with full-size affordance, image count, thumbnail hover feedback, and existing lightbox support.
- Strengthened the purchasing hierarchy with verified listing and vendor context, prominent pricing, clear in-stock/low-stock feedback, product facts, and a separated option-selection area.
- Made delivery calculation the primary full-width action before order placement, without changing backend pricing, permission, or delivery-quote rules.
- Added single-column tablet/mobile behavior with reduced dialog spacing and a shorter image aspect ratio.

## Vendor product editor refinement

- Reworked the vendor add/edit product dialog around the reviewed OS ZA e-commerce CMS reference while preserving Vastrivo's theme and moderation workflow.
- Expanded the editor into a responsive CMS-style layout: product details, customer options, pricing, and stock use the main column; photos and classification use a focused side panel.
- Promoted the first uploaded image to a large labelled shop-cover preview, with compact previews for the remaining images and a clearer add-more-images control.
- Replaced comma-separated ready-made size entry with reference-style selectable XS–XXL pills and an expandable custom-size control. Removed colour variants from both the vendor editor and customer checkout; edited products now save with no colour variants.
- Kept Save draft and Save & submit as distinct sticky actions. Submitting still requires an image and routes the complete listing through administrator verification.
- Added tablet and mobile fallbacks that collapse the editor cleanly without changing product validation or backend APIs.

## Form hardening and typography

- Added shared finite-number handling and explicit UI maximums for product/design prices, inventory, checkout quantity, tailoring measurements, invoice costs and quantities, delivery pricing, and measurement-category ordering. Oversized or non-finite input is clamped before it reaches application state; matching backend bounds remain authoritative.
- Added practical text limits across product/design descriptions, profiles, delivery addresses, authentication, vendor administration, measurement notes/categories, invoices, and delivery settings, plus a DOM-level default limit for any future text field that omits one. Product descriptions now show `current / 3,000` instead of an unbounded minimum-only counter.
- Strengthened delivery-address backend validation for field lengths, normalized phone numbers, and six-digit Indian PIN codes.
- Unified native selects across forms and toolbars with the same themed height, spacing, chevron, hover/focus, disabled, option, and dark-mode treatment.
- Replaced all remaining native `<select>` elements with one accessible Radix-based `AppSelect`. Open menus now use application-controlled surfaces, selected/check states, keyboard navigation, collision-aware portals, and matching light/dark styling instead of the Windows-native blue option popup.
- Replaced the previous Inter/Georgia stack with bundled Manrope Variable for interface text and Fraunces Variable for editorial headings. Font files ship with the frontend build, so deployed pages do not make runtime requests to Google Fonts.

## Notification inbox and activity history

- Changed the header notification popover into an unread-only inbox. Opening a notification removes it immediately, and Mark all read clears the list and badge.
- Added an unread-only filter, a focused unread index, and bounded pagination to the notifications API, keeping the lightweight header poll separate from full account history retrieval.
- Added an Activity log section under Profile & settings with read/unread state, timestamps, linked destinations, and progressive loading for older notifications.
- Added a direct View activity log action to the notification popover and synchronized notification changes between the header and profile without waiting for the next poll.

## Mobile studio and profile navigation

- Added a shared Designs / Products switcher to both vendor studio screens so vendors can move between tailoring designs and sale inventory without returning through another menu.
- Made the vendor switcher sticky on mobile and kept the bottom Studio destination active for both studio sections.
- Reworked the mobile profile menu into a compact four-tab sticky selector that remains visible while scrolling long profile sections.
- Profile section changes now return the selected content heading into view, and the previously compressed Activity log heading uses a proper stacked mobile layout.
- Tightened the mobile profile hero spacing while retaining the summary and full desktop presentation.

## Mobile catalogue density and responsive audit

- Replaced the smallest-screen single-column design and shop layouts with compact two-column commerce grids, following Amazon Store's documented two-products-per-mobile-row pattern.
- Standardized mobile catalogue cards around 4:5 imagery, concise two-line titles, visible pricing and stock, smaller badges, compact gallery controls, and reduced secondary copy.
- Reduced mobile page, hero, toolbar, empty-state, summary, vendor workspace, inventory, order, account, and profile-card spacing while keeping primary touch actions usable.
- Converted customer order views into a horizontally scrollable status rail and tightened expanded/collapsed order presentation.
- Changed Profile & settings navigation from a fixed four-column grid to a sticky horizontal rail with scroll snapping, allowing future settings sections without wrapping or unreadably narrow labels.
- Verified the dense catalogue and a six-option profile rail at a 440 x 956 mobile viewport in dark theme.
- Removed the redundant saved-fit and address counter cards from the Profile hero; section counts remain available in the Profile navigation.

## Validation

- `npm run build` — passing.
- `npm run lint` — passing with two existing Fast Refresh advisory warnings in shared component/context files.
- `npm audit --omit=dev` — reports the existing React Router RSC-mode CSRF advisory (`GHSA-qwww-vcr4-c8h2`); no automatic dependency upgrade was applied during the form/UI pass.
- Python source compilation — passing.
- FastAPI OpenAPI registration — all new order invoice/comment routes present.
- Live PostgreSQL startup/migration and authentication regression — passing.
- Live rollback-only invoice workflow regression — passing for both
  vendor-supplied cloth/payment and customer-supplied cloth/receipt gates,
  including additional line-item totals and rejection of payment without proof.
- Paginated order schemas, invoice revision metadata, JWT issuer/audience checks,
  security headers, and private object cache validators compile and register.
- Product-shop PostgreSQL migration and administrator API smoke test — passing.
- WebSocket ticket authentication and handshake regression — passing.

## Transactional email and password recovery

- Added provider-isolated backend email delivery through Resend's HTTPS API;
  no email provider API or credential is exposed to React.
- Added secure forgot-password and reset-password UI flows, one-time 20-minute
  reset tokens stored only as SHA-256 digests, generic account-enumeration-safe
  request responses, one-minute resend throttling, and full session revocation
  after a successful password change.
- Added welcome and password-change security messages plus a transactional email
  outbox automatically created with every new in-app notification/order update.
  The outbox uses retry state and delivers after successful mutating requests.
- Added local console-email configuration, Secret Manager / Cloud Run console
  instructions, and optional deployment-helper mapping for `RESEND_API_KEY`.
- Resend outbox requests include a stable per-row idempotency key to prevent
  duplicate notification emails when a provider response is retried.
- Brand-sensitive email text now reads from `APP_NAME` and `PUBLIC_APP_URL`, so
  the selected replacement brand can be applied without changing auth logic.
- Production UI build, frontend lint, Python compilation, FastAPI/PostgreSQL
  startup, route registration, safe public error responses, and 440 px mobile
  browser rendering all pass.

## Brand rename — Vastrivo selected

- Preliminary exact-name web, Google Play, Apple App Store, and public trademark
  searches on 7 August 2026 found no obvious tailoring/clothing app or website
  using **Vastrivo**, **Sutrivo**, or **Sewvani**.
- Preferred spelling is **Vastrivo** (`VAS-tri-vo`), followed by **Sutrivo**
  (`SOO-tri-vo`) and **Sewvani** (`soh-VAA-nee`). A registrar and formal Indian
  trademark clearance are still required immediately before registration.
- Selected **Vastrivo** as the replacement brand and applied it to visible copy,
  document titles, package labels, email defaults, vendor contact branding,
  favicon, browser storage keys, session request identifiers, and API metadata.
- Retained the existing `anu-tailoring` Cloud Run service name and GCP bucket
  identifiers to avoid creating duplicate infrastructure or disconnecting media.
- Verified the final sign-in page at 440 × 956: full Vastrivo wordmark fits the
  mobile header, document title is `Sign in · Vastrivo`, the new favicon loads,
  and no legacy customer-facing brand text remains.
- Authentication regression passes with `VastrivoUI`, `vastrivo_refresh`, the
  new JWT issuer/audience, refresh rotation, and logout revocation.

## OpenStreetMap delivery routing

- Added a backend `MAPS_PROVIDER` switch with `openstreetmap` as the default and
  retained `google` as an optional server-only provider.
- Added Nominatim-compatible Indian address geocoding and OSRM-compatible driving
  routes, provider-qualified cached location references, and provider binding in
  signed delivery quotes so a provider change invalidates stale quotes safely.
- Public OpenStreetMap endpoints are throttled, identified with a Vastrivo user
  agent, cached through the existing 29-day geocode policy, and blocked by
  default in production unless explicitly acknowledged. Managed or self-hosted
  compatible endpoints are required for production-scale customer addresses.
- Stored the routing provider with every delivery, added visible OpenStreetMap
  attribution wherever route-derived data is shown, and added an admin link that
  opens the saved pickup and destination coordinates on OpenStreetMap.
- Offline provider-contract regression, live PostgreSQL compatibility migration,
  Python compilation, production UI build, frontend lint, and local browser
  console checks pass without making an external geocoding or routing request.

## Cloud Build source packaging fix

- Fixed the root `.gitignore` `lib/` rule, which unintentionally excluded
  `frontend/src/lib/api.ts`, `formLimits.ts`, and `utils.ts` from GitHub and
  caused Cloud Build's TypeScript step to fail after source checkout.
- Scoped the Python packaging exclusion to the repository root as `/lib/`.
- Verified the frontend production build (`tsc -b && vite build`) passes.

## Precise location capture

- Added a reusable responsive **Locate me** panel to customer delivery-address
  create/edit dialogs and administrator vendor create/edit flows.
- Browser geolocation is used only to obtain the device coordinates; all reverse
  geocoding remains behind the authenticated backend API so map-provider calls
  and credentials are not exposed to React.
- The UI shows the resolved location, latitude/longitude, estimated device
  accuracy, privacy guidance, and an OpenStreetMap link. Saved customer address
  cards also show when a precise pin is available.
- Captured coordinates and provider-qualified place references are persisted in
  the existing address/vendor coordinate columns, so no database migration was
  required. Editing address text clears the old pin to prevent stale routing.
- Backend validation accepts only Indian locations and checks the captured
  location against the typed PIN code when one is present.
- Confirmed a reverse lookup near Jyothi Pinnacle resolves to Whitefields /
  Kondapur, Hyderabad, Telangana 500084 even though the building-name forward
  search is absent from OpenStreetMap.
- Python compilation, FastAPI route registration, frontend production build,
  frontend lint, and live OpenStreetMap reverse-geocoding checks pass.
- Refined the address flow so **Locate me** appears before the form fields and
  reverse-geocoded street/area, city, state, PIN and country values populate the
  form automatically. New customer addresses also start with the signed-in
  user's name and phone, while vendor location capture fills the pickup address.
- Added a Swiggy-style **Add receiver details** choice. It clears the prefilled
  recipient name and phone, focuses the receiver form, and provides a **Use my
  details** action to restore the signed-in user's contact information.
- Refined that receiver choice into a compact **Myself / Someone else** segmented
  selector above the contact fields, removing the second full-width card.
- Added OpenStreetMap locality fallbacks for reverse-geocoding results that omit
  a formal city boundary. Localities returned as suburb/neighbourhood (such as
  Nizampet) now populate the City field instead of leaving it blank.
- Fixed address saving after location capture: editing floor/building/street text
  no longer discards the captured coordinates. The reverse-geocode response now
  includes a user-bound, 30-minute signed location token; Save validates it and
  persists latitude, longitude and the provider place ID without a second map
  provider request. Existing saved coordinates are reused when unchanged.

## Super-admin role management

- Added a super-admin-only role selector for customer, vendor and administrator
  assignments. Super-admin accounts cannot be assigned or modified through the
  directory, preventing accidental privilege escalation or self-demotion.
- Added a Staff directory for administrator accounts, visible to super admins,
  and role badges throughout account cards.
- Role changes require explicit confirmation, take effect immediately, move the
  account to the correct directory, revoke its existing sessions so permissions
  cannot remain stale, and create an account activity notification.
- Role promotion is permission-only and never calls a map provider. Newly
  promoted vendors add their own verified workshop pickup point from Profile &
  settings after signing in again; delivery workflows remain unavailable until
  that setup is complete. Administrator deletion is blocked until the role is
  changed or the account is deactivated, preserving review/audit references.

## Map-first delivery addresses

- Replaced editable City, State and PIN fields in the customer address dialog
  with a location-first flow. Those components now come only from the verified
  reverse-geocode result; customers edit only recipient and building/delivery
  details that a map cannot provide.
- Added an interactive OpenStreetMap/Leaflet picker for deliveries to another
  location. Customers can pan and zoom, then tap the exact building or entrance;
  broad map taps zoom in before a location can be selected.
- Kept **Locate me** for the current device location. Both paths use the same
  authenticated backend reverse-geocoding endpoint and signed location token.
- Save remains disabled until latitude, longitude, locality, state and Indian
  PIN code are resolved, preventing incomplete delivery destinations.

## Fluid wide-screen layout

- Replaced the fixed 1180px application/header container with a fluid container
  that grows across desktop and ultrawide screens up to 2400px, with responsive
  side gutters so content remains balanced instead of being pinned to a narrow
  central column.
- Removed the separate 1320px administration workspace cap so administration,
  catalog, profile, orders and vendor pages all follow the same shared width.
- Kept catalog cards at a compact desktop size while adding columns automatically
  as usable width grows. Existing tablet and compact two-column mobile layouts
  remain unchanged.

## Vendor design creation media flow

- Added image selection directly to the create/edit design dialog, including on
  mobile. Vendors can preview and remove selected photos, identify the cover,
  and see the combined existing/pending count without saving and reopening the
  design card.
- Saving now creates the private draft first and then uploads the selected images
  through the backend in order. The existing limit of 10 JPEG/PNG/WebP images at
  5 MB each is enforced before upload.
- Added partial-upload recovery: if the draft saves but an image fails, the dialog
  remains open on that same draft and retains only the images still needing a
  retry, avoiding duplicate drafts and duplicate uploads.

## Vendor discovery, onboarding, and custom requests

- Added authenticated profile-photo upload and replacement for every account,
  with the existing initials avatar retained as the fallback. Photos are limited
  to validated JPEG/PNG/WebP files up to 5 MB, stored privately in GCS, served
  only through backend media routes, and refreshed immediately across the header
  and profile UI.
- Added vendor shop profiles with editable shop name, description, and logo.
  Logos use the same private backend-mediated media flow and appear with the shop
  name in the public-to-signed-in vendor directory and administrator directory.
- Added a **Vendors** destination to desktop and mobile navigation. Customers and
  vendors can search by shop, owner, description, or location, save vendors as
  favorites, filter to favorite vendors, and vendors cannot favorite or order
  from their own shop.
- Added customer vendor-access applications under Profile & settings. Requests
  contain a proposed shop name and optional business note, notify administrators,
  support rejected-request resubmission, and appear in a dedicated admin review
  queue. Admins can approve or reject with a review note; approval changes the
  account to vendor and unlocks shop/logo and pickup setup.
- Added private custom-order requests from the vendor directory. A hidden
  non-catalog design template connects each request to the existing measurement,
  address, route quote, order rejection/cancellation, WebSocket chat, notification,
  invoice approval, cloth, payment, and work-status workflows without polluting
  the public design catalogue or vendor design manager.
- Custom-order vendors can set the agreed tailoring service charge in the invoice
  after discussing the request in chat. Published-design orders continue to lock
  the service charge to the approved design price.
- Added schema compatibility statements and indexes for account media, shop and
  application data, favorite vendors, and private custom-order templates. Account
  deletion also performs best-effort cleanup of its profile photo and shop logo.
- Added `scripts.verify_vendor_directory`; backend schema/mapping checks, existing
  invoice and WebSocket workflows, Python compilation, frontend production build,
  frontend lint, and diff validation pass.

## Vendor storefront and form readability

- Removed the duplicate **Favorites** destination from the primary navigation;
  saved designs remain available through the Favorites filter inside the design
  catalog, and the Designs navigation item stays active for that filtered view.
- Vendor cards now open a dedicated shop page instead of exposing only a custom
  request action. The storefront presents the shop identity, description,
  location, specialties, favorite control, approved made-to-measure designs, and
  approved in-stock products owned by that vendor.
- Replaced the vertically stacked storefront catalog with adjacent **Designs**
  and **Products** tabs, rendering one collection at a time for quicker switching.
  Removed the repeated custom-request banner at the bottom; the primary request
  action remains in the shop header.
- Simplified vendor-card actions into two clearly separated full-width rows and
  shortened the customer-facing request label to **Custom order** in both the
  directory and shop header.
- Added vendor-filtered design and product catalog queries plus an authenticated
  vendor-profile endpoint. Product cards deep-link into the existing product
  purchase dialog, while design cards reuse the existing full image gallery,
  favorite, and made-to-measure order flow.
- Kept custom tailoring available from both the directory card and multiple
  storefront entry points. Vendors cannot order from their own shop, and shops
  without a saved pickup point now show the specific **Pickup setup pending**
  state instead of the ambiguous **Orders opening soon** message.
- Removed the duplicate custom-order delivery estimate. The route card is now the
  single delivery price presentation; a concise note explains that tailoring is
  quoted later without repeating the delivery amount.
- Increased shared form-label, input, helper, profile navigation, and section-copy
  readability. Inputs now have consistent 48px height and padding, upload format
  guidance sits on its own line, and ultra-wide profile forms stop stretching
  past a readable working width.
- Extended `scripts.verify_vendor_directory` to verify vendor storefront routes
  and vendor catalog filters. Frontend build/lint, Python compilation, product
  shop, order invoice, WebSocket chat, and vendor schema checks pass.

## Vendor-scoped combined cart, order, delivery, and invoice

- Added a session-scoped cart that accepts both made-to-measure designs and shop
  products, while enforcing one vendor per checkout. Adding an item from another
  vendor now asks the buyer to finish or clear the current vendor cart first.
- Replaced immediate design/product ordering with **Add to cart**. The cart keeps
  each design's measurement, cloth choice, fabric preference and notes, plus each
  product's quantity and selected options.
- Added a dedicated responsive cart and navigation badge. Buyers choose one saved
  address and request one vendor-to-address route quote for the complete cart.
  Checkout submits every selected line as one atomic order with one delivery token.
- Added vendor-scoped combined-order persistence for product lines, locked product
  price snapshots, stock reservation/restoration, an order-level invoice, and
  additional invoice line items. Existing tailoring and product order records remain
  readable through their legacy flows.
- New orders now enforce a single active vendor on the backend, reject own-shop
  purchases, validate stock/options, and create only one `Delivery` record. Customer
  cancellation or vendor rejection closes all lines, restores product stock, and
  cancels the shared delivery; neither is allowed after invoice acceptance.
- Vendors now create and send one invoice for the full order. The invoice locks
  published tailoring prices, product totals and the one delivery charge, while
  allowing custom tailoring, cloth and itemized agreed costs. Customers approve or
  request changes once for the complete order.
- Updated customer, vendor and administrator order cards to show design and product
  lines together, one delivery summary, and one combined invoice. Legacy standalone
  shop orders remain visible for historical compatibility.
- Added compatibility schema creation for the new order product/invoice tables and
  the nullable vendor scope on historical orders. Fixed the two `Order`-to-`User`
  relationships to use explicit foreign keys.
- Verification: frontend TypeScript/Vite production build passes; backend Python
  compilation and FastAPI OpenAPI/schema loading pass, including combined invoice
  and vendor rejection routes.
- Simplified the customer checkout action from **Place combined order** to
  **Place order**; grouping remains an internal order behavior rather than customer
  terminology. Refined shared confirmation/cancellation popups with an inset body,
  consistent edge spacing, rounded clipping, and mobile-safe action spacing so alert
  cards, text fields, and buttons no longer touch the dialog edges.
- Registration now labels the vendor address as a support contact and loads it from
  the backend `VENDOR_CONTACT_EMAIL` setting through a narrowly allowlisted public
  config endpoint. Provider credentials and other environment values remain private.

## Search discovery and public landing page

- Added a public, responsive Vastrivo homepage at `/` for anonymous visitors and
  search crawlers, with semantic headings and useful content covering custom
  tailoring, made-to-measure designs, verified vendors, clothing, and order flow.
  Signed-in users continue to see the existing Designs catalog at the same route.
- Added a production `sitemap.xml` with the canonical `https://vastrivo.in/` URL and
  a root-level `robots.txt` that references the sitemap while excluding authenticated,
  account, order, cart, vendor-studio, administration, and API routes.
- Added a self-referencing canonical URL, search description, robots metadata,
  Open Graph fields, and `WebSite` JSON-LD. Route-aware metadata marks non-public
  application screens `noindex, nofollow` in the client.
- Verified the production bundle copies and serves both discovery files; XML parsing,
  robots sitemap reference, TypeScript/Vite build, and frontend lint pass.
- Added explicit backend `/sitemap.xml` and `/robots.txt` responses ahead of the SPA
  fallback. This prevents an incomplete/stale frontend bundle from serving the login
  application for crawler files; both responses validate as HTTP 200 with the proper
  XML/plain-text media types and use `PUBLIC_APP_URL` for production URLs.

## Razorpay Standard Checkout

- Integrated Razorpay Standard Web Checkout into the existing customer cloth-payment
  gate for both combined vendor orders and legacy single-design orders. Invoice amounts
  are derived and validated on the backend in paise; the browser cannot choose or alter
  the payable amount.
- Added authenticated create-order and verify-payment endpoints. The backend reuses an
  existing provider order for retry safety, verifies the Razorpay HMAC signature, fetches
  and captures an authorized payment when necessary, then verifies provider order,
  currency, amount, and captured status before marking an invoice paid.
- Added provider-neutral gateway identifiers to combined and legacy invoice records,
  unique partial indexes for provider order/payment IDs, startup compatibility changes,
  and reset behavior when a vendor revises an invoice.
- Replaced the customer’s manual offline transaction-reference input with a secure
  Razorpay modal, including script-load, modal-dismiss, failed-payment, and backend-error
  feedback. The Key Secret remains backend-only; the authenticated create-order response
  exposes only the publishable Key ID required by Checkout.
- Split checkout entry into **UPI / QR** and **Cards & more**. The UPI action uses
  Razorpay's supported display configuration to open a focused UPI-only experience,
  reducing the cramped multi-method QR screen while preserving every other payment
  method through the secondary action. No unsupported cross-origin iframe styling is used.
- Added the missing combined-invoice cloth-bill proof controls so vendors can attach or
  replace the required proof and customers can review it before paying.
- Added safe environment placeholders and Cloud Run Secret Manager deployment guidance.
  Local `.env` remains ignored by Git.
- Verification passed: Razorpay SDK installation, Python compilation, FastAPI route/schema
  loading, persisted create/verify/paid-state workflow with a fake provider, existing
  order-invoice workflow, frontend lint, and the Vite production build.

## Razorpay production readiness

- Added public, mobile-responsive Contact, Pricing, Shipping, Cancellation & refunds,
  Privacy, and Terms pages. They remain available without sign-in, are linked from the
  public footer, receive indexable canonical metadata, and are included in `sitemap.xml`.
- Added a normalized payment ledger for provider order/payment/refund IDs, customer and
  vendor ownership, cloth/final stages, captured amounts, failures, and cumulative refunds.
- Added a signed public Razorpay webhook endpoint. It verifies the HMAC against the raw
  request body, limits payload size, deduplicates `X-Razorpay-Event-Id`, records processing
  results, tolerates out-of-order events, and reconciles captured, failed, and refund events.
- Added Admin → Payments with searchable transaction and vendor-settlement views. Only a
  super administrator can initiate source refunds or change payout records; paid settlements
  require a bank/payout reference.
- Captured payments automatically create pending manual vendor-settlement records. Platform
  delivery is excluded from vendor payable value, refunds hold or reduce unpaid settlements,
  and refunds after payout are flagged for recovery review. This ledger does not claim to
  perform an automatic bank transfer or Razorpay Route transfer.
- Added customer/vendor notifications for captured payments and refund progress, GCP Secret
  Manager guidance for the separate webhook secret, and the exact live webhook events/URL.
- Expanded the offline Razorpay verifier to cover the payment ledger, settlement creation,
  full refund processing, signature validation, and a delayed captured webhook that must not
  overwrite an already-refunded transaction.

## Vendor tailoring progress controls

- Hide the `Tailoring status is unlocked` guidance once every active tailoring item is completed, so shipping and delivered orders no longer show a stale action prompt.

- Fixed the missing post-approval controls for vendor-scoped combined orders. When the
  customer supplies cloth, the vendor can now confirm receipt once for the combined
  invoice; every active tailoring line then becomes ready to start.
- Added sequential, guarded status actions to each design in both combined and legacy
  orders: **Start tailoring**, **Move to stitching**, **Move to quality check**, and
  **Mark tailoring completed**. The backend prevents skipping stages and rechecks invoice,
  cloth-receipt, and cloth-payment gates before work starts.
- Customer notifications are created for cloth receipt and every tailoring status change,
  while the order-level status is synchronized with its item progress.
- Added responsive progress action cards and confirmation dialogs so vendor actions remain
  visible alongside each design on desktop and mobile.
- Combined design cards now read approval, payment, and cloth readiness from the shared
  combined invoice instead of the empty legacy per-design invoice, fixing stale “not
  started / waiting” journey labels after invoice approval.
- Extended the existing authenticated order-chat WebSocket with database-backed workflow
  events. Customer, vendor, and administrator screens now receive order, tailoring,
  invoice, payment, and cloth-gate status changes without manually refreshing, including
  when the two users are connected to different Cloud Run instances.
- Refined combined order cards with inset design, journey, action, and chat panels,
  consistent rounded borders, and additional desktop/mobile spacing so controls no longer
  touch the outer card edges.
- Verification passed for customer- and vendor-supplied cloth, legacy and combined invoice
  gates, all four tailoring transitions, frontend lint/build, and Python compilation.

## Flexible vendor and customer fulfilment

- Vendors can now choose **Platform distance pricing** or **My own fixed delivery
  price** in Profile → Workshop & pickup. A vendor fee is validated on the backend
  and charged once for every design/product grouped into that vendor order.
- Customer checkout now offers three separate fulfilment choices: **Deliver to me**,
  **Self-delivery**, and **Self-pickup**. The two customer-arranged choices are
  enforced as ₹0 by the backend and cannot be changed through browser payloads.
- Home delivery automatically resolves to the vendor's saved pricing mode. Signed
  quote tokens bind the vendor, address, provider, fulfilment method, and current
  price; stale quotes are rejected when vendor settings change.
- Each persisted delivery now records its fulfilment method. Customer/vendor order
  views and admin delivery management distinguish platform delivery, vendor delivery,
  customer-arranged delivery, and workshop pickup without showing route controls for
  modes that do not use routing.
- Existing orders migrate as platform delivery, and existing vendors default to
  platform pricing. Verification passed for schema compatibility, vendor settings,
  signed fixed-fee quotes, zero-cost pickup, combined invoice totals, Python compile,
  frontend lint, and the Vite production build.

## Final order payment and shipping gate

- Separated the optional vendor-cloth advance from the final order balance. Completed
  invoices now retain an independent final-payment status instead of incorrectly showing
  **Payment not required** when cloth cost is zero.
- Customer order cards expose Razorpay Checkout after every active tailoring line is
  completed. The backend derives the amount from the locked invoice and deducts an
  already captured cloth advance so it is never charged twice.
- Razorpay create/verify calls now support cloth and final-payment stages with separate,
  unique provider order/payment identifiers. Final payment is marked paid only after
  signature verification and captured amount, currency, and order validation.
- Vendors receive a final-payment notification and can move a paid completed order to
  shipping. The backend rejects early dispatch; customer self-pickup instead presents a
  fulfilment-aware **Ready for pickup** action and notification.
- Added final-payment fields to startup schema compatibility, API responses, frontend
  live workflow updates, and invoice reset handling. Offline persisted verification now
  covers cloth advance, deducted final balance, payment capture, and the gated shipping
  transition.
- Verification passed: Python compilation, Razorpay lifecycle script, order-invoice
  workflow script, frontend lint, Vite production build, and `git diff --check`.

## Delivery-agent dispatch and tracked handoff

- Delivery-management order cards can now be expanded or collapsed from their summary header; delivered and cancelled records start collapsed while active work remains open.

- Split vendor readiness from courier movement. A vendor now marks a fully paid,
  completed order **Ready for shipping**; its delivery becomes **Booked** rather
  than incorrectly becoming **In transit** before anyone collects it.
- Added stable automatic tracking references in the `VST-D########` format at the
  vendor handoff. The combined order stores the same reference, and admin delivery
  management presents it as generated read-only data.
- Added the `delivery_agent` account role. Super admins can assign this role from
  Staff management; role changes revoke existing sessions so permissions are
  applied on the next sign-in.
- Added admin dispatch controls for booked platform deliveries. Admins can assign
  or reassign an active delivery agent, see whether the agent has shared a recent
  position, and open a route from that position to the next stop.
- Added a dedicated responsive Delivery Partner workspace. Agents see only their
  assigned jobs, customer contact details, vendor pickup and customer destination,
  and guarded actions for **Confirm pickup → Start delivery → Mark delivered**.
  Pickup synchronizes the order to **Shipped**; final handoff synchronizes it to
  **Delivered** and notifies both customer and vendor.
- Agent position sharing is explicit, not continuous: pressing **Share/Update my
  location** uses browser geolocation, stores the coordinates and accuracy on the
  backend, and makes them visible only to that agent and administrators. Generic
  user/order profile payloads do not expose courier coordinates.
- Added startup-compatible database evolution for the role, agent assignment,
  location, assignment/pickup/delivery timestamps, and the native PostgreSQL order
  status. Production security headers now allow same-origin geolocation.
- Verification passed: full persisted assignment/location/status lifecycle,
  automatic tracking generation, authorization route registration, payment-to-
  readiness regression coverage, Python compilation, Vite TypeScript production
  build, and `git diff --check`.

## Vendor storefront availability messaging

- Removed the customer-facing `Pickup setup pending` action from vendor directory
  cards and vendor storefront headers. Pickup readiness remains an internal vendor/
  administrator concern.
- `Custom order` now appears only when that vendor is able to accept one. Empty
  design messaging is neutral when custom ordering is unavailable.

## Android and iOS application (foundation implemented; roadmap continues)

### Implemented in the first native increment

- Added an Expo/React Native/TypeScript application under `mobile/` with Expo
  Router, EAS development/preview/production profiles, the Vastrivo light/dark
  visual system, Android package and iOS bundle ID `in.vastrivo.app`, permission
  descriptions, secure storage, and app/universal-link declarations.
- Added dedicated FastAPI mobile login, rotating refresh, and logout endpoints.
  Native refresh credentials are device-bound, stored hashed in PostgreSQL,
  returned only to the native client, rotated on every use, and revoked on reuse
  or logout. Browser cookie authentication continues unchanged.
- Added session device metadata and last-use tracking to `auth_sessions`, startup
  compatibility statements, and `scripts/verify_mobile_auth.py` coverage for
  login, rotation, old-token rejection, device mismatch, logout, and web-session
  regression.
- Implemented customer auth/discovery/vendor/storefront/order/profile flows,
  native Razorpay checkout backed by the existing server-side create/verify
  endpoints, profile-photo upload, vendor applications, vendor design draft/edit,
  1–10 backend-mediated 5 MB image uploads, review submission, and delivery-agent
  assignment/location/status flows.
- Pinned Expo SDK 54 with the legacy architecture intentionally enabled
  (`newArchEnabled: false`) because Razorpay's current
  React Native wrapper is not yet supported on the mandatory New Architecture in
  Expo SDK 55+. Added `expo-dev-client`; generic Expo Go is not supported.
- Added root mobile start/check/build commands and `mobile/README.md` with local
  Android, macOS iOS, Windows EAS, production secret, signing, link-association,
  and store-readiness instructions.
- Added the Expo SDK 54-compatible `expo-system-ui` dependency so automatic
  light/dark system appearance is included when native Android/iOS projects are
  generated. Local Android builds still require Android Studio, API 36,
  Platform-Tools/ADB, `ANDROID_HOME`, and an emulator or connected device.
- Verification passed: Python compilation, mobile auth integration/regression
  scripts, strict mobile TypeScript/config validation, and all 18 Expo Doctor
  dependency/configuration checks.

### Direction and scope

- Build one TypeScript mobile application in a new `mobile/` workspace using Expo,
  React Native, Expo Router, and EAS Build. Use development builds because Razorpay
  and other native SDKs are not an Expo Go-only workflow.
- Keep FastAPI, PostgreSQL, GCS, Razorpay, Resend, routing, and the existing WebSocket
  chat as the shared backend. The website and mobile app must use the same accounts,
  catalog, orders, payments, notifications, and delivery records.
- Reuse API types, validation rules, formatting helpers, and business state machines in
  a shared package. Do not attempt to reuse DOM components or the current CSS; create
  accessible native screens that preserve the Vastrivo visual system and both themes.
- Ship customer, vendor, and delivery-agent experiences in one app with role-aware
  navigation. Keep large super-admin tables, moderation, configuration, refunds, and
  settlement operations web-first for the initial store release; add focused mobile
  approval/dispatch actions later if operationally necessary.
- Tentative application identifiers are `in.vastrivo.app` for Android and iOS, with
  `vastrivo://` deep links plus verified `https://vastrivo.in/...` app/universal links.
  Confirm identifiers before the first store build because changing them after release
  creates a separate app.

### Phase 0 - make the backend a stable mobile platform

1. Introduce versioned `/api/v1` routes or a compatibility layer before a store release,
   publish the OpenAPI contract, and generate a typed client shared by web and mobile.
2. Add dedicated mobile session endpoints. Continue using 10-minute access tokens, but
   return rotating, device-bound refresh credentials for encrypted native storage rather
   than depending on a browser-only HTTP-only cookie. Track device/session name, last use,
   revocation, and logout-all; never place tokens in AsyncStorage.
3. Add device-registration endpoints for APNs/FCM/Expo push tokens, per-device notification
   preferences, token rotation, and deletion on logout. Notifications remain persisted in
   the existing activity log; push is only a delivery channel.
4. Standardize pagination, server-side filtering, image thumbnail variants, upload retry/
   idempotency keys, structured API errors, request correlation IDs, and mobile-safe rate
   limits. Complete Alembic migrations and change money columns to NUMERIC first.
5. Add mobile configuration discovery for minimum supported version, maintenance mode,
   public API origin, feature flags, policy URLs, and forced/optional upgrade messages.

### Phase 1 - mobile foundation

1. Create `mobile/` with development, preview, and production EAS profiles; separate test
   and production API/Razorpay configuration; no secrets in Expo public configuration.
2. Build the shared design system: Manrope/Fraunces fonts, colors, spacing, buttons, native
   selects, forms, sheets, dialogs, loading/empty/error states, dark mode, safe areas,
   keyboard avoidance, screen-reader labels, dynamic text, and tablet breakpoints.
3. Implement secure session restore, automatic access-token refresh, role changes, account
   deactivation handling, offline/network banners, retry boundaries, deep-link routing,
   analytics consent, and privacy-safe crash reporting.
4. Establish CI checks for TypeScript, lint, unit tests, Android preview builds, iOS preview
   builds, dependency/security review, and backend contract compatibility.

### Phase 2 - customer MVP

1. Authentication: registration, sign-in, password reset, logout, profile photo, personal
   details, measurements, addresses, map pin selection, and current-location permission.
2. Discovery: designs, products, vendors, search/filters, favorites, vendor storefronts,
   image galleries, product/design details, and native share/deep links.
3. Ordering: vendor-grouped cart, custom order, cloth choice, measurement/address selection,
   platform/vendor/self delivery, self pickup, invoice review, cancellation rules, order
   timeline, activity log, and persisted WebSocket chat with reconnect/background catch-up.
4. Payments: integrate Razorpay's React Native Standard SDK while retaining server-side
   order creation, signature verification, capture reconciliation, webhooks, refunds, and
   idempotency. Clothing and tailoring are physical goods/services, so Razorpay—not Apple
   In-App Purchase or Google Play Billing—is the intended checkout path; re-check store
   policies immediately before submission.
5. Delivery: tracking reference, booked/picked-up/in-transit/delivered timeline, route link,
   and notifications without exposing a courier's raw location beyond authorized views.

### Phase 3 - vendor workspace

1. Vendor request/onboarding status, shop profile/logo, pickup map pin, availability, and
   internal setup guidance.
2. Native camera/gallery selection, compression, 5 MB validation, background-safe upload
   queue, progress, retry, reordering, preview, and 1-10 image rules for designs/products.
3. Draft/edit/submit/moderation feedback flows, design/product catalog, inventory, order
   expansion, chat, invoice creation, cloth requirements/cost, bill proof, rejection rules,
   tailoring stages, payment gate, and ready-for-shipping/self-pickup handoff.
4. Vendor settlement read-only summaries and export/support contact; retain refund and paid-
   settlement mutation under super-admin web controls.

### Phase 4 - delivery-agent workspace

1. Assigned-job list, pickup/customer details, route launch, call/contact actions, and the
   guarded booked -> picked up -> in transit -> delivered workflow.
2. Explicit foreground location sharing first. Add optional background tracking only after
   a separate privacy, battery, retention, and App Store/Play disclosure review; never make
   continuous tracking a hidden requirement.
3. Add proof-of-pickup/delivery, timestamp, notes, failed-delivery reasons, customer OTP or
   signature, offline action queue, and conflict-safe server reconciliation.

### Phase 5 - native platform capabilities

- Push notifications for chats, approvals/rejections, invoices, payments, tailoring stages,
  dispatch, pickup, delivery, cancellations, and vendor applications. Deep-link each push to
  its authorized screen and suppress sensitive message text on locked screens by default.
- Camera/photo permission, location permission, maps, opening dialer/email, native sharing,
  biometric app unlock for returning sessions, app icon/splash, universal links, and Android
  notification channels. Ask for each permission only when its feature is invoked.
- Cache read-only catalogs and order summaries with bounded storage; never cache payment
  credentials, refresh tokens outside encrypted storage, or unrestricted private images.

### Phase 6 - security, QA, and release readiness

1. Threat-model mobile auth, deep links, uploads, chat, payment callbacks, screenshots/logs,
   rooted/jailbroken devices, replay attempts, and lost-device session revocation. Add a
   dependency/SBOM process and verify release signing provenance.
2. Automated tests: shared state machines, API contract tests, component tests, Android/iOS
   device tests, slow/offline networks, token expiry, WebSocket reconnect, upload recovery,
   Razorpay success/failure/dismissal, duplicate webhooks, and delivery authorization.
3. Manual device matrix: current/minimum Android, small/large phones, current/minimum iOS,
   tablet layouts where supported, light/dark, accessibility font sizes, screen readers,
   camera/location denial, Indian phone formats, UPI intent apps, and low-memory recovery.
4. Prepare store assets and compliance: privacy policy, terms, account deletion inside the
   app, data-safety/privacy nutrition disclosures, permission explanations, content rating,
   support URL/email, screenshots, review demo account, review notes explaining the physical
   goods/services business model, and a documented incident/rollback process.

### Phase 7 - staged launch and operations

1. Internal development builds -> Android internal testing and iOS TestFlight -> invited
   customer/vendor/delivery pilot -> percentage rollout -> public release.
2. Add privacy-safe crash/performance monitoring, API/mobile-version dashboards, payment and
   webhook alerts, push-delivery health, upload failures, chat reconnect rate, checkout
   conversion, and operational runbooks. Do not record chat, precise addresses, tokens,
   payment payloads, or unrestricted image URLs in analytics.
3. Define minimum supported versions and a rollback strategy. Backend changes remain backward
   compatible for at least the active mobile support window because store updates are not
   installed immediately.

### First release definition of done

- A customer can register, manage fit/address data, discover and order from a vendor, chat,
  approve/pay an invoice, and track fulfilment on Android and iOS.
- A vendor can manage shop/listings, discuss and invoice orders, progress tailoring, and hand
  off paid work without needing the web app for normal daily operations.
- A delivery agent can receive an assignment and complete the authorized handoff workflow.
- Logout/revocation, payment verification, uploads, push/deep links, accessibility, privacy,
  crash-free preview builds, and store review requirements have evidence-backed test results.
- Recommended implementation order: Phase 0 -> Phase 1 -> customer MVP -> vendor workspace ->
  delivery agent -> hardening/store launch. Do not start UI screen duplication before the
  mobile authentication and versioned API contracts are settled.

## Unified 5 MB image upload limit

- Set the maximum image size to 5 MB for vendor design images,
  product images, profile photos, and vendor shop logos.
- Applied the same validation and user-facing guidance across FastAPI, the React
  website, and the Expo Android/iOS client. JPEG, PNG, and WebP signature/type
  validation and the 10-image listing limit remain unchanged.
- Kept invoice cloth-bill images and PDFs at their existing 5 MB limit, so every
  current image upload path now accepts files up to 5 MB.
- Updated the default environment configuration and deployment documentation;
  an explicitly configured production `MAX_DESIGN_IMAGE_MB` value must be `5`.

## Centered user messages

- Replaced the global top-right toast placement with a centered, responsive
  message overlay so feedback remains visible on wide screens and mobile devices.
- Success, error, loading, informational, and custom messages share the same
  accessible presentation with type-specific colour/icon treatment.
- Every message can be dismissed immediately with a labelled close button and
  automatically closes after three seconds. Long backend error text wraps safely
  inside the notification instead of overflowing the viewport.

## Catalog performance and mobile issue pass

- Added private 900 px WebP thumbnails for every new design and product upload.
  Existing catalog images are converted and cached lazily on their first thumbnail
  request, so no database migration or public bucket access is required.
- Catalog grids now defer authenticated image downloads until they approach the
  viewport and use the compressed preview. Detail dialogs and image lightboxes keep
  the original-resolution source. Original and thumbnail objects are deleted together.
- Removed public published/available counters from vendor storefronts and removed
  design/shop totals from the native discovery switcher.
- Reworked the native profile into read-only details with explicit pencil editing and
  a compact menu for theme, delivery addresses, measurements, activity, and sign out.
- Added native address, measurement, activity-log, Studio product, and vendor custom-
  order screens. Studio now presents Designs and Products as separate actions, and
  product creation includes 1-10 private images with the shared 5 MB limit.
- Corrected order-detail authorization so the customer, participating vendor, and
  administrators can open an authorized order while unrelated users still receive 404.
- Verification completed with frontend build/lint, Expo TypeScript/config checks,
  Python compilation, catalog-thumbnail verification, product-shop regression checks,
  and the order workflow suite including vendor order-detail access.

## Versioned database migration milestone

- Added Alembic with a single, frozen `20260826_0001` baseline that can create a
  fresh PostgreSQL schema or idempotently adopt databases created by the former
  startup initializer. Its downgrade is intentionally non-destructive.
- Removed all table creation, `ALTER TABLE`, enum changes, and index creation
  from FastAPI startup. Startup now checks `alembic_version` against the code's
  migration head, fails with an actionable error when deployment skipped a
  migration, and then performs only expired-token cleanup plus reference/admin
  data seeding.
- `start-dev.cmd` now applies `alembic upgrade head` before starting FastAPI and
  Vite. Added `npm run db:migrate` and `npm run db:status` for explicit local use.
- The production image now contains the migration configuration and revisions.
  `deploy-gcp.cmd` first executes a one-task `<service>-migrate` Cloud Run Job
  with Cloud SQL and Secret Manager access, and deploys the service only when
  that migration succeeds.
- Added a regression check that creates a uniquely named disposable PostgreSQL
  database, upgrades it from empty to head, verifies required tables/revision,
  and drops it. Existing local data was adopted at the same head without table
  or object deletion.
- Verification completed with Python and launcher syntax checks, migration
  graph/history, `npm run db:status`, existing-database upgrade and startup
  checks, a fresh 30-table database migration through revision `20260826_0003`, a
  clean Alembic model-drift check, and
  the auth, mobile-auth, order-invoice, delivery, and Razorpay regressions.

## Native first-release workflow milestone

- Completed the remaining native customer, vendor, and delivery-agent daily
  workflows. Administrative moderation, user management, settlements, and dispatch
  remain intentionally web-console workflows for the first store release.
- Added an unread notification bell to top-level native screens. The notification
  inbox shows only unread updates, supports read/read-all actions, and preserves
  read history in the existing Activity log.
- Moved the customer vendor application out of the generic Workspace tab and into
  Profile as “Become a vendor”. Customer and administration accounts no longer see
  an empty Workspace tab; vendors retain Studio and delivery agents retain Deliveries.
- Added native order chat for every tailoring item with authenticated send and
  incremental five-second refresh. Customer and vendor messages share the same
  backend conversation and notification ownership rules as the web application.
- Added native vendor invoice creation/editing for single and combined orders,
  including service price, cloth requirement/cost, additional line items, draft/send,
  and 5 MB cloth-bill image proof. Customers can approve or request invoice changes,
  complete Razorpay payments, and see invoice totals in the same order view.
- Added vendor cloth-receipt confirmation, tailoring stage actions, and the paid
  ready-for-shipping handoff. Delivery agents retain assignment status actions and
  can now see pickup/drop-off markers and a route preview inside each delivery card.
- Added `react-native-maps` with a draggable address pin. “Locate me” reverse-resolves
  through the backend and customers can adjust the precise delivery point before save.
- Catalog grid cards now support horizontal, paged image swiping with an image counter
  while continuing to request optimized private thumbnails; detail screens keep the
  full-resolution images.
- Cleared the completed entries from `issues.md`. Verification passed with the Expo
  TypeScript/config check, Expo Doctor (18/18), frontend production build, Alembic
  upgrade/current/drift checks at `20260826_0003`, Python compilation, order-invoice,
  delivery-management, and authentication regressions, plus `git diff --check`.

## Native live order-status tracker correction

- Replaced the fixed native order footer—which always highlighted Invoice and
  Fulfilment—with stages derived from the current invoice, every active tailoring
  item, final payment, order, and delivery records.
- Tailoring now exposes the live substage in the footer: awaiting invoice/cloth,
  ready to start, fabric cutting, stitching, quality check, or completed. Combined
  orders also show how many items are complete without advancing past a slower item.
- Vendor actions refresh the order immediately. While the order is open, a quiet
  five-second refresh keeps customer/vendor views synchronized; returning to the
  cached screen also fetches fresh server state.
- Verification passed with the native Expo TypeScript and public-config check.

## Expanded web-order spacing correction

- Added a clear top gutter above cancellation/locked notices so their border no
  longer touches the order context strip.
- Added outer gutters around combined invoice and product cards inside expanded
  orders: 20 px on desktop and 14 px on mobile, matching the surrounding order
  item layout without changing the card sizes.
- Verified the generated local CSS rules, frontend production build, and lint.

## Vendor Studio navigation — feature 1

- Replaced the native vendor Studio's detached status tiles and recent-order feed
  with three accessible navigation rows for Designs, Products, and Customer orders.
- Studio now shows compact draft/pending badges for designs and products and the
  total customer-order count; these refresh whenever the Studio regains focus.
- Added Draft, Pending, Approved, and Rejected count filters inside the dedicated
  design and product screens, where listing status now belongs.
- Added a dedicated vendor Customer orders screen with Active, All, Delivered, and
  Cancelled filters, pull-to-refresh, customer identity, totals, and order-detail
  navigation. Vendor purchases remain separate under My orders.
- Fixed Android filter-chip clipping on the Customer orders screen by constraining
  the horizontal filter row, centring each chip, and using an explicit text line height.
- Feature 1 from `continue.md` is complete. Vendor customer relationships are the
  next isolated feature. Native Expo TypeScript and public-config verification passed
  again after the Android Customer orders filter-chip layout correction.

## Recommended next milestone

The detailed next-session specification is saved in [`continue.md`](continue.md).
It covers the Vendor Studio navigation redesign and vendor customer, measurement,
standalone invoice, private PDF, native, and web work requested on 29 August 2026.

1. Add API-level integration tests for role authorization, backend upload
   completion, moderation transitions, bucket cleanup, and notification ownership.
2. Add per-measurement “how to measure” guidance and diagrams.
3. Add a Cloud Tasks dispatcher for outbox retries at production scale, plus
   vendor business profiles, admin audit logs, and forced temporary-password change.
4. Move persisted monetary columns from FLOAT to PostgreSQL NUMERIC and add
   server-side catalog/order search before large-scale use.
5. Complete Razorpay KYC/live-mode activation, configure the production webhook
   secret in Secret Manager, and run a small live payment/refund smoke test before
   accepting customer payments broadly.
6. Continue mobile hardening with push-device registration, shared generated API
   types, idempotent uploads, accessibility/device-matrix testing, and signed
   TestFlight/Play internal builds.

## Resume prompt

“Continue from `continue.md`, then use `progress.md` for completed-project context.
Preserve the current warm editorial UI and both themes, and update both tracking
files when the milestone is done.”
