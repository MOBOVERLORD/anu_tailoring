# Continuation plan: Vendor Studio, customers, measurements, and invoices

Last updated: 2 September 2026

Status: Features 1 (Studio navigation redesign) and 2 (secure vendor-customer
relationship backend) are complete. Features 3–10 remain pending and must
continue one feature at a time.

Maintenance note: the whole-piece product stock validation issue was resolved on
2 September 2026 across FastAPI, desktop/mobile-width web, and the native create
form. It no longer blocks Feature 3.

The Codex task cannot read the account-level usage meter. The user reported that
the current meter shows 35%, so this work was intentionally recorded for the next
session instead of being started today.

## Requested outcome

Redesign the vendor Studio so it is a navigation hub rather than a dashboard full
of detached counts and recent orders. Then add a vendor-owned customer workspace
where vendors can maintain customer measurements and issue standalone downloadable
invoices, including for customers who are themselves vendors.

The mobile app must also preserve a valid signed-in device session and the user's
selected theme across process restarts, phone reboots, and app upgrades. These are
recorded as Feature 10 so they are implemented and verified as an isolated mobile
reliability change rather than mixed into the vendor-customer data migration.

The screenshot in the originating task shows the current native Studio. The
primary surface for this milestone is the Android/iOS app, with matching backend
capabilities and web parity for vendor customer/invoice management.

## 1. Studio navigation redesign

**Completed.** The native Studio is now a navigation-only hub. Designs and
Products show draft/pending badges and open status-filtered management screens;
Customer orders opens a dedicated vendor sales screen. The detached four-count
grid and embedded recent-order list were removed. The Android Customer orders
filter row was also corrected so labels and counts are not vertically clipped.

Remove these sections from the native vendor Studio landing screen:

- the separate Draft, Submitted, Approved, and Rejected count tiles;
- the embedded Recent customer orders list.

Replace them with a scalable navigation menu. Each menu item must be one clear
tap target and may include a small relevant badge or subtitle:

1. **Designs** → existing `/studio/designs` screen. Show draft and pending-review
   counts on this menu item; keep the full status breakdown inside the Designs
   screen.
2. **Products** → existing `/studio/products` screen. Show draft and pending-review
   counts on this menu item; keep the full status breakdown inside Products.
3. **Orders** → vendor sales/order list, not the vendor's own purchases. Show the
   number of active customer orders and route to the existing vendor-order view.
4. **Customers** → new vendor customer directory. Show the total linked/customer
   contact count and route to the new customer list.
5. Keep room for future entries such as shop settings, reports, and payouts without
   returning to a fixed two-column count dashboard.

Use compact full-width rows or a responsive two-column menu with icon, title,
description, badge, and chevron. Preserve the warm editorial visual language,
light/dark themes, touch targets, and mobile safe-area behavior.

## 2. Vendor customer model

**Completed on 2 September 2026.** The versioned Alembic model, exact-match
linking, secure new-customer invitation, consent state, vendor-scoped list/detail
and notes APIs, customer accept/decline actions, one-time password setup, and
rollback-only regression coverage are implemented. Existing vendor accounts can
be linked as customers without role mutation. Cross-vendor reads are hidden and
database constraints guard self-links and concurrent duplicates.

A vendor's customer is a relationship, not an account role. Therefore an existing
user whose account role is `vendor` can still be added as another vendor's customer.
Do not change that user's role.

Recommended data model:

- `vendor_customer_relationships`
  - `id`, `vendor_id`, `customer_user_id`, `status`, vendor-private notes;
  - timestamps, invitation/acceptance timestamps, and created-by audit fields;
  - unique constraint on `(vendor_id, customer_user_id)`;
  - prevent a vendor from adding their own account as a customer.
- Keep account identity in the existing `users` table. Do not duplicate names,
  emails, or phone numbers in the relationship table except immutable invoice
  snapshots.

The phrase “new user which can be created by customer” is assumed to mean **a new
customer account created/invited by the vendor**.

### Adding a customer

The vendor can:

1. Link an existing active account using an exact normalized email and phone match.
2. Invite a new customer with full name, email, and phone number. The backend creates
   only a `customer` account and sends a secure password-setup invitation through
   the existing Resend email service. Never expose or generate a reusable default
   password in the UI.

Security and integrity requirements:

- normalize emails to lowercase and phone numbers to a canonical Indian/E.164 form;
- enforce unique email and unique phone constraints in PostgreSQL, not only UI;
- if email and phone resolve to different existing users, return HTTP 409;
- concurrent duplicate requests must still produce one account/relationship;
- never allow this flow to create admin, super-admin, delivery-agent, or vendor roles;
- use exact-match lookup only so vendors cannot browse the global user directory;
- recommended: require an existing user to accept the vendor relationship before
  the vendor can see account-owned data; vendor-entered invoice/measurement records
  remain vendor-scoped until acceptance.

## 3. Customer directory and detail UI

Add a Customers screen under Studio with:

- search by customer name, exact email, or phone;
- filters for active and invited customers;
- Add customer action supporting existing-account link and new invitation;
- customer row showing name, contact information, relationship status, saved
  measurement count, invoice count, and most recent activity;
- pagination/server-side search so the list scales.

Customer detail should use expandable sections or tabs:

1. **Overview** — contact details, relationship/invite status, and vendor notes.
2. **Measurements** — measurement profiles recorded for this customer.
3. **Invoices** — drafts and finalized invoices for this customer.

## 4. Vendor-recorded customer measurements

Vendors can create multiple named measurement profiles for each linked customer.
Reuse the administrator-configured measurement categories, garment types, units,
validation ranges, and India-tailoring field definitions already in the project.

Store ownership and provenance explicitly:

- customer user ID;
- owning/creating vendor ID;
- profile name, garment/category, unit, values, notes;
- `created_by_vendor_id`, creation/update timestamps, and optional last-used date.

A vendor may read and edit only profiles they created for their customer unless a
future sharing/consent feature explicitly broadens access. The customer should be
able to see the profile and its source after accepting the relationship.

## 5. Standalone customer invoices

These invoices are independent of marketplace orders. A vendor can create multiple
invoices for a customer and see the complete invoice history under that customer.

Recommended tables:

- `vendor_customer_invoices` — vendor/customer relationship, invoice number,
  status (`draft`, `finalized`, `void`), issue/due dates, currency, seller/customer
  snapshots, subtotal, discount, tax, grand total, notes, payment note, PDF object
  metadata, and timestamps;
- `vendor_customer_invoice_lines` — description, quantity, unit, unit price, line
  total, sort order, and optional service/product classification.

Important rules:

- calculate all totals on the backend using decimal/NUMERIC values;
- assign invoice numbers transactionally and uniquely per vendor;
- draft invoices are editable; finalized invoice financial fields are immutable;
- voiding preserves history and audit data rather than deleting the invoice;
- the invoice list shows status, number, issue date, total, and download action;
- invoice detail can be opened from the customer record.

### PDF download and sharing

- Generate the PDF on the backend using a Cloud Run-friendly library such as
  ReportLab; do not depend on client-side browser printing.
- Include Vastrivo/vendor branding, shop logo and contact details, customer details,
  invoice number/dates, line items, totals, optional GST/tax data, notes, and payment
  terms.
- Store finalized PDFs privately in GCS using a stable path similar to
  `vendors/{vendor_id}/customers/{relationship_id}/invoices/{invoice_id}/invoice.pdf`,
  or generate them deterministically on demand.
- Expose only an authenticated, ownership-checked PDF endpoint. Do not make the
  bucket or invoice URLs public.
- Web: Download PDF action. Native: download to app cache and open the operating
  system share sheet so the vendor can share it through WhatsApp, email, etc.

## 6. Proposed API surface

- `GET /api/vendor/customers`
- `POST /api/vendor/customers/link`
- `POST /api/vendor/customers/invite`
- `GET /api/vendor/customers/{relationship_id}`
- `PATCH /api/vendor/customers/{relationship_id}`
- `GET/POST /api/vendor/customers/{relationship_id}/measurements`
- `GET/PATCH/DELETE /api/vendor/customers/{relationship_id}/measurements/{profile_id}`
- `GET/POST /api/vendor/customers/{relationship_id}/invoices`
- `GET/PATCH /api/vendor/customer-invoices/{invoice_id}`
- `POST /api/vendor/customer-invoices/{invoice_id}/finalize`
- `POST /api/vendor/customer-invoices/{invoice_id}/void`
- `GET /api/vendor/customer-invoices/{invoice_id}/pdf`

Final endpoint names should follow the current FastAPI router conventions after
reviewing the existing order invoice and measurement modules.

## 7. Implementation order for the next session

1. Audit existing user uniqueness, phone normalization, measurement ownership,
   vendor summary, invoice, PDF/storage, email invitation, and vendor-order routes.
2. Add an Alembic migration for relationship, measurement provenance, invoice,
   invoice-line, indexes, unique constraints, and exact ownership foreign keys.
3. Implement schemas/services/API authorization and transactional uniqueness.
4. Add backend PDF generation and private download; add invitation email flow.
5. Build native Studio navigation and Customers list/detail/measurement/invoice UI.
6. Add web vendor customer and invoice parity.
7. Add regression coverage, then update `issues.md` and `progress.md`.
8. Implement Feature 10 separately: persistent mobile device sessions and persisted
   theme preference, including upgrade/restart/offline verification.

## 8. Required verification

- migration from the current Alembic head and fresh-database upgrade;
- existing vendor can link a customer-role user and a vendor-role user;
- duplicate email, duplicate phone, mismatched identities, self-link, unauthorized
  vendor access, and concurrent creation are rejected correctly;
- vendor-created measurement ownership cannot cross vendors;
- invoice totals use exact decimals and finalized invoices cannot be silently edited;
- PDF downloads only for the owning vendor and related/authorized customer;
- private GCS object is never exposed directly;
- native Android/iOS type/config checks and web build/lint;
- a signed-in mobile user survives process termination, a phone reboot, and an app
  upgrade without entering credentials again while the device session remains valid;
- temporary offline/startup API failures do not erase a valid stored mobile session;
- logout revokes the server-side device session, removes local credentials, and does
  not allow the previous refresh token to restore access;
- light, dark, and follow-system preferences survive process termination and an app
  upgrade without a light/dark flash during startup;
- role, authentication, order invoice, notification, and storage regressions remain
  green.

## 9. Acceptance criteria

- Studio contains navigation cards/rows instead of detached status-count tiles and
  recent orders.
- Designs and Products show only their useful draft/pending badge in Studio.
- Orders opens the vendor customer-order list.
- Customers opens a searchable vendor customer directory.
- A vendor account can be another vendor's customer without changing roles.
- Vendors can invite a new unique customer or link an existing exact identity.
- Vendors can save multiple customer measurement profiles.
- Vendors can create, review, finalize, download, and share multiple invoices under
  each customer.
- All access is vendor-scoped, server-authorized, audited, and covered by tests.
- Mobile users remain signed in until explicit logout or a genuine security
  invalidation; ordinary restarts, upgrades, and transient network failures do not
  send them to Login.
- The selected mobile theme persists across restarts and upgrades. Follow-system
  changes only when the operating-system theme changes.

## 10. Mobile session and theme persistence

**Pending.** The current native implementation stores the rotating refresh token in
`expo-secure-store`, which is the correct location, but it still needs the following
reliability and lifecycle work.

### Persistent mobile sign-in

The user-facing rule is: after a successful login, the app stays signed in on that
device until the user logs out. Reauthentication is permitted only when the account
or device session is genuinely invalidated—for example password/security reset,
administrator revocation, account deactivation, refresh-token replay, cleared app
data, or uninstall. A temporary network/server failure must never be treated as a
logout.

Implementation requirements:

- keep access tokens short-lived (10 minutes) and memory-only; never place the access
  token in AsyncStorage, source code, logs, or app configuration;
- keep only an opaque refresh credential in `expo-secure-store` using the existing
  device identifier, and restore the session automatically during native startup;
- make the backend mobile device session durable until logout/security revocation,
  with hashed refresh credentials, one-time rotation, replay detection, last-used
  metadata, and transactional revocation;
- separate `offline/temporarily unavailable` from `refresh rejected`. Startup must
  retain the stored refresh credential and offer retry/offline UI for transport and
  5xx failures; clear the session only for a confirmed invalid/revoked credential;
- keep the single-flight refresh mutex and retry an authorized API request only once;
- explicit logout must revoke the current backend device session before clearing
  SecureStore, and local credentials must still be cleared if the revoke request
  cannot reach the server;
- add a future “Sign out all devices” path to revoke every mobile device session
  after password compromise or account recovery;
- document that uninstalling/clearing app data removes the device credential and
  therefore requires login again.

### Persistent theme choice

The current `ThemeProvider` keeps its override only in component state, so a reload
or app update falls back to the operating-system theme. Replace that behavior with a
stored preference:

- model the preference explicitly as `system`, `light`, or `dark`;
- persist it under a versioned native storage key (AsyncStorage is appropriate for
  this non-sensitive setting) and hydrate it before rendering the routed UI;
- retain the preference across process termination, phone reboot, OTA update, and
  installed app upgrade; clearing app data/uninstall may reset it;
- prevent a startup theme flash by keeping the splash/loading surface visible until
  the preference and fonts are ready;
- when preference is `system`, continue responding to live OS colour-scheme changes;
- apply the resolved theme consistently to the status bar, navigation surfaces,
  dialogs, maps/placeholders, and Razorpay launch surface where configurable;
- migrate unknown/old stored values safely to `system` and add unit/integration tests
  for hydration, toggling, restart, and upgrade-compatible storage keys.

## Resume prompt

“Continue from `continue.md` one feature at a time. Features 1 and 2 are complete;
implement only Feature 3, the native vendor Customers directory and customer detail
overview UI, next. Use the existing `/api/vendor/customers` relationship APIs,
preserve light/dark themes and server-side ownership, and update `progress.md` plus
`issues.md` after verification. Keep measurements, invoices, web parity, and Feature
10 (persistent mobile session and theme preference) queued as separate features.”
