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
  - Upload 1–10 JPEG, PNG, or WebP images, up to 2 MB each.
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
  - Upload validation enforces MIME type, matching file signatures, a 2 MB size
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
    sizes and colours, and 1–10 private images up to 2 MB each.
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
    2 MB each, and all uploads continue through the authenticated backend.
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

## Recommended next milestone

1. Replace startup compatibility statements with versioned Alembic migrations
   before production data exists.
2. Add API-level integration tests for role authorization, backend upload
   completion, moderation transitions, bucket cleanup, and notification ownership.
3. Add per-measurement “how to measure” guidance and diagrams.
4. Add a Cloud Tasks dispatcher for outbox retries at production scale, plus
   vendor business profiles, admin audit logs, and forced temporary-password change.
5. Move persisted monetary columns from FLOAT to PostgreSQL NUMERIC, generate
   image thumbnails, and add server-side catalog/order search before large-scale use.
6. Integrate a payment gateway and replace the current offline payment-reference
   verification flow before accepting production payments.

## Resume prompt

“Continue from `progress.md`. Start with the next milestone, preserve the current warm editorial UI and both themes, and update `progress.md` when done.”
