# Anu Tailoring — Progress

Last updated: 2026-07-31

## Current milestone

The first multi-vendor design publishing workflow is implemented across the
React frontend, FastAPI backend, PostgreSQL, and Google Cloud Storage.

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
  the temporary contact address `vendors@anutailoring.com`.

### Completed

- Responsive login screen with Anu Tailoring brand mark, icons, password visibility control, loading/error feedback, and light/dark themes.
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
- Session expiry clears local tokens and returns the customer to sign-in.
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

## Measurement reference notes

The presets follow Indian vocational tailoring material rather than one universal body-size chart. The UI intentionally stores body measurements by garment because a saree blouse, kameez, kurta, and trouser require different dimensions.

- INFLIBNET basic kameez material: bust, waist, hip, shoulder, garment length, sleeve length/round, neck and torso-related dimensions.
- Bharat Skills men’s-wear material: chest, waist, hip, shoulder, neck, bicep, sleeve, shirt length, thigh, and outseam.
- Bharat Skills dressmaking material: natural waist, full length, shoulder, sleeve, bust/chest, hip, neck, inner/outer leg, rise, knee and bottom round.

## Validation

- `npm run build` — passing.
- `npm run lint` — passing with two existing Fast Refresh advisory warnings in shared component/context files.
- Python source compilation — passing.
- A live backend integration run was not performed in this task because the available bundled Python runtime does not contain the project’s FastAPI/SQLAlchemy packages.

## Recommended next milestone

1. Replace startup compatibility statements with versioned Alembic migrations
   before production data exists.
2. Add integration tests for role authorization, backend upload completion,
   moderation transitions, bucket cleanup, and notification ownership.
3. Add per-measurement “how to measure” guidance and diagrams.
4. Add a transactional outbox/retry worker for bucket deletion, vendor business
   profiles, admin audit logs, password reset, and forced temporary-password change.
5. Add pagination, search indexes, NUMERIC pricing, image thumbnails, and CDN
   delivery before the catalog grows.
6. Begin the garment customization and order flow after validating the
   marketplace with real vendor designs.

## Resume prompt

“Continue from `progress.md`. Start with the next milestone, preserve the current warm editorial UI and both themes, and update `progress.md` when done.”
