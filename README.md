# Vastrivo

Vastrivo is a React and TypeScript marketplace UI backed by FastAPI,
PostgreSQL, and Google Cloud Storage. It supports customer, vendor, and admin
workflows.

## Start everything

Prerequisites:

- Node.js 20 or newer
- Python 3.11 or newer
- PostgreSQL running with a database matching the values in `.env`

From the project root in the VS Code terminal:

```powershell
.\start-dev.cmd
```

The first run creates `.venv` and installs the frontend and backend packages. Later runs start immediately.

Open:

- UI: http://127.0.0.1:5173
- Backend API: http://127.0.0.1:8000
- Interactive API documentation: http://127.0.0.1:8000/docs

Press `Ctrl+C` once in the terminal to stop both services.

## Android and iOS app

The repository now includes a shared Expo/React Native client in `mobile/` for
Android and iOS. It connects to the same FastAPI API and accounts as the website;
its rotating refresh credential is device-bound and stored with the operating
system's encrypted secure storage.

Install and validate it from the project root:

```powershell
cd mobile
npm.cmd install
Copy-Item .env.example .env.local
cd ..
npm.cmd run mobile:check
```

Run the Android development build with `npm.cmd run mobile:android`. A native
development build is required because Razorpay cannot run in generic Expo Go.
Local iOS compilation requires macOS/Xcode; from Windows use EAS Build. See
[`mobile/README.md`](mobile/README.md) for API URLs, Android/iOS commands, EAS
profiles, store prerequisites, and current native feature coverage.

## Database and environment setup

The existing `.env` is used automatically. For a new checkout:

1. Copy `.env.example` to `.env`.
2. Create the PostgreSQL database named in `POSTGRES_DB`.
3. Fill in the PostgreSQL password, JWT secret, and initial admin credentials.
4. Run `.\start-dev.cmd`.

The launcher installs dependencies, runs `alembic upgrade head`, and then starts
the UI and API. FastAPI verifies that PostgreSQL is at the expected migration
revision before it performs safe reference-data and initial-admin seeding; it
does not create or alter tables during application startup.

Database-only commands are available when you do not need to start the app:

```powershell
npm.cmd run db:migrate
npm.cmd run db:status
```

For every schema change, create and review a new Alembic revision and apply it
before deploying code that depends on it. Never edit a migration already used
in a shared environment.

Public registration always creates a `customer`. The configured seeded account
is the `super_admin`; it can create verified vendors and manage customer/vendor
access. Regular `admin` accounts can review designs and view account directories
but cannot modify member accounts.

Authentication uses 10-minute access tokens and rotating 30-minute refresh
sessions. The refresh token is stored only in an `HttpOnly` cookie; the UI
refreshes it automatically while active. Logout revokes the persisted session
immediately. In production the cookie is also marked `Secure` and requires HTTPS.

Password recovery uses one-time, 20-minute tokens. Only a SHA-256 token digest is
stored in PostgreSQL, successful resets invalidate every active session, and the
public request endpoint always returns the same response so it does not reveal
whether an email is registered. In local development, `EMAIL_PROVIDER=console`
prints the reset message in backend logs for testing.

## Transactional email

The backend sends welcome, password-reset, password-change, notification, and
order-update emails. Browser code never calls the email provider. In-app
notifications and their email work are written atomically to a retryable
PostgreSQL outbox; delivery runs after successful mutating requests so the user
response is not held open by the provider API.

For production, use Resend's HTTPS Email API from Cloud Run. Google Cloud does
not provide a general-purpose transactional email sender. Keep the Resend API
key in Secret Manager and let only the backend call the provider.

Console setup (no service-account file or provider key is committed):

1. In Resend, add a sending domain (a dedicated subdomain such as
   `updates.your-domain.example` is recommended), add the supplied SPF and DKIM
   DNS records, and wait for the domain to become **Verified**. Create a
   **Sending access** API key restricted to that domain.
2. In **Google Cloud Console → Security → Secret Manager**, create a secret such
   as `resend-api-key` and paste the API key as its first version.
3. Open that secret's **Permissions** tab and grant the Cloud Run runtime service
   account **Secret Manager Secret Accessor** for this secret only.
4. In **Cloud Run → your service → Edit and deploy new revision → Variables &
   Secrets**, expose that secret as `RESEND_API_KEY` and add:

   ```text
   EMAIL_PROVIDER=resend
   EMAIL_FROM_ADDRESS=no-reply@updates.your-domain.example
   EMAIL_FROM_NAME=Vastrivo
   EMAIL_NOTIFICATIONS_ENABLED=true
   PUBLIC_APP_URL=https://your-public-app-url.example
   APP_NAME=Vastrivo
   ```

5. Deploy the revision and request a password-reset email. The sender address or
   domain must be verified by Resend before production delivery will work.

The deployment helper can map the secret without placing its value in Git:

```powershell
$env:GCP_RESEND_SECRET="resend-api-key"
$env:PUBLIC_APP_URL="https://YOUR_CLOUD_RUN_OR_CUSTOM_DOMAIN"
$env:APP_NAME="Vastrivo"
$env:EMAIL_FROM_ADDRESS="no-reply@updates.YOUR_DOMAIN"
$env:EMAIL_FROM_NAME="Vastrivo"
.\deploy-gcp.cmd
```

Vendor image uploads require `GCS_BUCKET_NAME` and Google Application Default
Credentials. For local GCS testing, authenticate once with:

```powershell
gcloud auth application-default login
```

For local development, set `GCS_SIGNING_SERVICE_ACCOUNT` in the ignored `.env`
to the runtime service-account email. The backend automatically impersonates
that account for bucket operations using the developer's short-lived ADC.
Never place the real value in `.env.example` or another tracked file.

Automatic delivery pricing uses a provider-neutral backend adapter. OpenStreetMap
is the default for local development and uses Nominatim-compatible geocoding plus
OSRM-compatible driving routes:

```text
MAPS_PROVIDER=openstreetmap
OSM_NOMINATIM_URL=https://nominatim.openstreetmap.org
OSM_ROUTING_URL=https://router.project-osrm.org
```

The public OpenStreetMap endpoints have strict rate limits, no service-level
guarantee, and privacy restrictions. The backend identifies itself, throttles
requests, caches geocoded coordinates for 29 days, does not implement address
autocomplete, and blocks the public endpoints in production by default. Before
accepting real production orders, set `OSM_NOMINATIM_URL` and `OSM_ROUTING_URL`
to managed or self-hosted compatible services. Do not send real customer address
data to the public development endpoints.

Review the official [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
and [OSRM demo-server policy](https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy)
before changing the production safeguard. Vastrivo does not embed or proxy the
community tile service; the admin route button opens OpenStreetMap only after an
administrator chooses it.

Google remains available as a runtime fallback. Enable the **Geocoding API** and
**Routes API**, create a server-only key restricted to those APIs, and configure:

```text
MAPS_PROVIDER=google
GOOGLE_MAPS_API_KEY=your-restricted-server-key
```

React never receives provider credentials. Administrators verify each vendor's
pickup address, customer addresses are geocoded by FastAPI, and provider-qualified
location references plus refreshable coordinates are stored in PostgreSQL. A
signed 10-minute quote prevents a second route request when the customer places
the order. The configured price is charged for every started 0.1 km (100 metres).

## Start the services separately

Backend:

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

UI, from a second terminal:

```powershell
cd frontend
npm.cmd run dev
```

If PowerShell blocks virtual-environment activation, run the backend without activation:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Google Cloud deployment

The repository is ready for Google Cloud Run:

- `Dockerfile` builds the React UI and packages it with FastAPI.
- FastAPI serves both the UI and `/api` routes from one Cloud Run container.
- The server listens on Cloud Run's injected `PORT`.
- `.env` is excluded from uploads and container images.
- `DATABASE_URL` supports Cloud SQL, while secrets can be supplied through Secret Manager.

### One-time GCP setup

1. Install the Google Cloud CLI and authenticate:

   ```powershell
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

2. Create a PostgreSQL Cloud SQL instance and a database.

3. Create a dedicated private bucket and runtime service account:

   ```powershell
   $PROJECT_ID = gcloud config get-value project
   $REGION = "asia-south1"
   $BUCKET_NAME = "YOUR_PRIVATE_DESIGN_BUCKET"
   $RUNTIME_SA = "YOUR_RUNTIME_SERVICE_ACCOUNT_EMAIL"

   gcloud services enable storage.googleapis.com iamcredentials.googleapis.com
   gcloud iam service-accounts create YOUR_SERVICE_ACCOUNT_NAME --display-name="Application runtime"
   gcloud storage buckets create "gs://$BUCKET_NAME" --location=$REGION --uniform-bucket-level-access
   gcloud storage buckets add-iam-policy-binding "gs://$BUCKET_NAME" --member="serviceAccount:$RUNTIME_SA" --role="roles/storage.objectAdmin"
   ```

   `roles/storage.objectAdmin` is scoped to this bucket, enabling the API to
   upload, read, and delete design objects. Local developers who impersonate
   this account also need Token Creator on the service account; Cloud Run uses
   the attached runtime identity directly.

4. Keep the bucket private. Browser CORS is not required because the React UI
   sends multipart uploads to FastAPI and FastAPI performs every Cloud Storage
   operation using its server-side identity.

5. In Secret Manager, create:

   - A secret containing the production database URL.
   - A secret containing the JWT signing key.
   - A secret containing the restricted Google Maps Platform API key.
   - A secret containing the Resend sending API key.
   - Separate secrets containing the Razorpay Key ID, Key Secret, and Webhook
     Secret. The webhook secret must be a different high-entropy value. Use
     Test Mode keys outside production and rotate any key that has been shared.

   The database URL should use the async PostgreSQL driver and URL-encode any
   special characters in the password:

   ```text
   postgresql+asyncpg://USER:PASSWORD@/DATABASE?host=/cloudsql/PROJECT:REGION:INSTANCE
   ```

6. Grant the runtime service account access to both secrets and the
   **Cloud SQL Client** role.

### Deploy

In PowerShell:

```powershell
$env:GCP_PROJECT="YOUR_PROJECT_ID"
$env:GCP_REGION="asia-south1"
$env:GCP_CLOUD_SQL_INSTANCE="PROJECT:REGION:INSTANCE"
$env:GCP_DESIGN_BUCKET="YOUR_PRIVATE_DESIGN_BUCKET"
$env:GCP_SERVICE_ACCOUNT="YOUR_RUNTIME_SERVICE_ACCOUNT_EMAIL"
$env:GCP_DATABASE_SECRET="YOUR_DATABASE_SECRET"
$env:GCP_JWT_SECRET="YOUR_JWT_SECRET"

.\deploy-gcp.cmd `
  --set-secrets=DATABASE_URL=YOUR_DATABASE_SECRET:latest,SECRET_KEY=YOUR_JWT_SECRET:latest,GOOGLE_MAPS_API_KEY=YOUR_MAPS_KEY_SECRET:latest,RAZORPAY_KEY_ID=YOUR_RAZORPAY_KEY_ID_SECRET:latest,RAZORPAY_KEY_SECRET=YOUR_RAZORPAY_KEY_SECRET_SECRET:latest,RAZORPAY_WEBHOOK_SECRET=YOUR_RAZORPAY_WEBHOOK_SECRET:latest
```

The command first builds and executes a single-task Cloud Run Job named
`anu-tailoring-migrate` (or `<GCP_SERVICE>-migrate`). The job runs `alembic
upgrade head` with the same runtime identity and Cloud SQL connection. Only
after it succeeds does the command build and deploy the Cloud Run service. This
prevents a new revision from receiving traffic against an older schema. The
migration job needs Secret Manager access to the database and JWT secrets and
the runtime identity needs Cloud SQL Client. This follows Google Cloud's
recommended Cloud Run Job pattern for database migrations.

The service then prints its public URL. Future deployments use the same command.
Cloud Run preserves the service configuration, so after the first deployment
you can normally run:

```powershell
.\deploy-gcp.cmd
```

You can also use:

```powershell
npm.cmd run deploy:gcp
```

Use `.\deploy-gcp.cmd --help` to see the supported environment variables.

### Git-triggered continuous deployment

The default Cloud Run **Connect repository** trigger builds and updates the
service directly. It does not know that this application requires an Alembic
migration before FastAPI starts. After a revision adds a migration, deploying
with that generated trigger makes startup fail before the container can bind to
`PORT=8080`.

The repository-level [`cloudbuild.yaml`](cloudbuild.yaml) fixes that ordering for
the Git-connected `anu-tailoring-git` service:

1. Build and push one immutable commit image.
2. Update `anu-tailoring-git-migrate` to that same image.
3. Execute the migration job and wait for success.
4. Update `anu-tailoring-git` only after the migration completes.

Bootstrap the migration job once with the normal deployment command, using the
Git-connected service name and the production environment variables described
above:

```powershell
$env:GCP_SERVICE="anu-tailoring-git"
.\deploy-gcp.cmd
```

Then open **Cloud Run → anu-tailoring-git → Edit repo settings**, edit the Cloud
Build trigger, select **Cloud Build configuration file (YAML or JSON)**, and set
the location to `/cloudbuild.yaml`. The defaults assume region `asia-south1` and
Artifact Registry repository `cloud-run-source-deploy`; override `_REGION`,
`_SERVICE`, `_MIGRATION_JOB`, or `_AR_REPOSITORY` in the trigger when the actual
resource names differ.

The Cloud Build service account needs permission to push to that Artifact
Registry repository and to update/execute the Cloud Run service and migration
job. Do not remove the migration job's Secret Manager mappings, Cloud SQL
attachment, or runtime service account: subsequent builds preserve them and
only update its image.

The production container also performs a fast migration-head check before
starting Uvicorn. This is a safety net for Cloud Run repository triggers that
still use Google's generated build instead of `cloudbuild.yaml`. When the schema
is behind (including a legacy database without `alembic_version`), the entrypoint
uses a PostgreSQL advisory lock, rechecks after acquiring it, applies `alembic
upgrade head`, verifies the resulting head, and only then starts the server on
Cloud Run's `PORT`. Current schemas take the read-only fast path. Keep the
dedicated migration job as the preferred deployment gate; the guarded entrypoint
prevents a skipped gate from producing another port-8080 startup failure.

### Razorpay production activation

The checkout, signature verification, payment ledger, refunds, and vendor
settlement records are implemented. Before accepting live money:

1. Complete Razorpay KYC and submit `https://vastrivo.in` under **Account &
   Settings → Business website details**. The public Contact, Pricing,
   Shipping, Cancellation & refunds, Privacy, and Terms pages are linked in
   the unauthenticated footer and sitemap. Before submission, set the Cloud Run
   environment variables `BUSINESS_LEGAL_NAME`, `BUSINESS_ADDRESS`,
   `SUPPORT_PHONE`, and `VENDOR_CONTACT_EMAIL` to the real registered business
   and support details shown on those pages.
2. In **Live Mode**, generate a new Key ID and Key Secret. Put them in the two
   Secret Manager secrets mapped above. Never add them to a `VITE_` variable.
3. Enable automatic payment capture in Razorpay Dashboard. The backend also
   fetches a returned payment and captures an authorised payment when needed,
   but fulfilment proceeds only after Razorpay reports `captured`.
4. Under **Account & Settings → Webhooks**, create an active webhook:

   ```text
   https://vastrivo.in/api/payments/razorpay/webhook
   ```

   Subscribe to `payment.captured`, `payment.failed`, `order.paid`,
   `refund.created`, `refund.processed`, and `refund.failed`. Set a new webhook
   secret and store the exact same value in the `RAZORPAY_WEBHOOK_SECRET`
   Secret Manager secret. The endpoint validates the raw request signature,
   deduplicates `X-Razorpay-Event-Id`, and safely accepts out-of-order events.
5. Make one small live payment and verify all three records before opening the
   service broadly: the Razorpay payment is **captured**, the Vastrivo Admin →
   Payments transaction is **captured**, and a pending vendor settlement was
   created. Test a refund while the transaction value is still small.

The vendor settlement screen is an internal manual payout ledger. Customer
payments settle to Vastrivo's primary Razorpay account. Do not mark a vendor
settlement paid until the bank transfer reference is available. Automated
splitting requires separate approval for Razorpay Route and linked accounts.

Order chat uses authenticated WebSockets. The deployment command sets Cloud
Run's request timeout to 60 minutes and enables best-effort session affinity.
Clients reconnect automatically because Cloud Run can close a socket at the
configured timeout or route a reconnect to another instance. Messages are
stored in PostgreSQL and sockets reconcile from the last message ID, so chat
history and cross-instance delivery do not depend on one container's memory.

## Vendor buying and selling

- Vendors can purchase designs and shop products from other active vendors.
- A vendor's own listings remain previewable but cannot be ordered by that vendor.
- **My orders** (`/orders`) contains purchases made by the signed-in account.
- **Sales orders** (`/vendor/sales-orders`) contains tailoring and product orders
  placed with the vendor and exposes the fulfilment, invoice, rejection, and
  customer-chat actions.

## Design publishing workflow

- Customers browse only approved designs and can save favorites.
- Vendors create drafts, upload 1–10 JPEG/PNG/WebP images (up to 5 MB each),
  edit details, and submit for review.
- Vendors can preview every design image in a keyboard-accessible zoom viewer.
  Editing an approved/published design or its images automatically moves it back
  to draft and removes it from the customer catalog until it is approved again.
- Admins and super admins approve submissions or reject them with a required
  reviewer comment. Only super admins can edit, activate/deactivate, or delete
  customer and vendor accounts; accounts referenced by designs or orders must be
  deactivated rather than deleted.
- Vendors and admins receive in-app notifications for submissions and decisions.
- Deleting a design first deletes every associated bucket object. A design
  referenced by an order is retained to preserve order history.

The browser sends multipart image data only to FastAPI. FastAPI validates the
type, file signature, 5 MB limit, and 10-image design limit before uploading to
Cloud Storage. Image downloads are also proxied through authenticated FastAPI
media endpoints. PostgreSQL stores the durable bucket/object key, not a
container filesystem path, so Cloud Run redeployments do not remove images.

Completed images in the bucket configured through `GCS_BUCKET_NAME` use this
object hierarchy:

```text
vendors/
  {vendor_id}/
    designs/
      {design_id}/
        {unique_image_id}.jpg
```

Google Cloud Storage represents these folders as object-name prefixes, so the
vendor and design folders appear automatically when FastAPI uploads the first
validated image.

## Vendor shop workflow

- Vendors open **Products** from their workspace and create either a ready-made
  garment (priced per piece) or fabric (priced per metre), including stock,
  sizes/colours, and 1–10 images.
- Product drafts are submitted to **Administration → Shop products**. Only an
  approved, in-stock product from an active vendor appears in the customer Shop.
- Customers choose the variant, quantity, and saved address. FastAPI obtains the
  driving route, signs the short-lived delivery quote, locks stock during
  checkout, and stores a separate shop order plus its delivery record.
- Shop orders appear in the same Order Centre for customers, vendors, and
  administrators. Vendors progress fulfilment through confirmed, packed,
  shipped, and delivered; cancelling before shipment restores stock.

Product images remain private and are proxied through authenticated FastAPI
media endpoints. They use this GCS object hierarchy:

```text
vendors/
  {vendor_id}/
    products/
      {product_id}/
        {unique_image_id}.jpg
```

## Tailoring order cancellation

- A customer can cancel the complete tailoring order until any invoice in that
  order is accepted.
- A vendor can reject only the item belonging to their own design, also only
  before that item's invoice is accepted.
- Both actions require a reason, retain the closed item in order history,
  notify the other party, and cancel the applicable delivery charge.
- Invoice acceptance is irreversible for cancellation purposes. This rule is
  enforced by FastAPI for customer, vendor, and administrator requests, not
  only by hiding buttons in the UI.
