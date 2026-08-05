# Anu Tailoring

Anu Tailoring is a React and TypeScript marketplace UI backed by FastAPI,
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

## Database and environment setup

The existing `.env` is used automatically. For a new checkout:

1. Copy `.env.example` to `.env`.
2. Create the PostgreSQL database named in `POSTGRES_DB`.
3. Fill in the PostgreSQL password, JWT secret, and initial admin credentials.
4. Run `.\start-dev.cmd`.

FastAPI creates the initial tables and admin account when the backend starts.
Public registration always creates a `customer`. The configured seeded account
is the `super_admin`; it can create verified vendors and manage customer/vendor
access. Regular `admin` accounts can review designs and view account directories
but cannot modify member accounts.

Authentication uses 10-minute access tokens and rotating 30-minute refresh
sessions. The refresh token is stored only in an `HttpOnly` cookie; the UI
refreshes it automatically while active. Logout revokes the persisted session
immediately. In production the cookie is also marked `Secure` and requires HTTPS.

Vendor image uploads require `GCS_BUCKET_NAME` and Google Application Default
Credentials. For local GCS testing, authenticate once with:

```powershell
gcloud auth application-default login
```

For local development, set `GCS_SIGNING_SERVICE_ACCOUNT` in the ignored `.env`
to the runtime service-account email. The backend automatically impersonates
that account for bucket operations using the developer's short-lived ADC.
Never place the real value in `.env.example` or another tracked file.

Automatic delivery pricing uses Google Maps Platform entirely from FastAPI.
Enable the **Geocoding API** and **Routes API** in the Google Cloud console,
create a separate server-side API key restricted to those two APIs, and add it
only to the ignored local `.env`:

```text
GOOGLE_MAPS_API_KEY=your-restricted-server-key
```

The React UI never receives this key. Administrators verify each tailoring
vendor's pickup address, and customer delivery addresses are geocoded by the
backend. Place IDs and refreshable coordinates are stored in PostgreSQL; route
distance is calculated with Routes API Compute Route Matrix. A signed 10-minute
quote prevents a second Google route request when the customer places the order.
The configured price is charged for every started 0.1 km (100 metres).

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

.\deploy-gcp.cmd `
  --set-secrets=DATABASE_URL=YOUR_DATABASE_SECRET:latest,SECRET_KEY=YOUR_JWT_SECRET:latest,GOOGLE_MAPS_API_KEY=YOUR_MAPS_KEY_SECRET:latest
```

The command builds from the repository `Dockerfile`, deploys the Cloud Run
service, and prints its public URL. Future deployments use the same command.
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
- Vendors create drafts, upload 1–10 JPEG/PNG/WebP images (up to 2 MB each),
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
type, file signature, 2 MB limit, and 10-image design limit before uploading to
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
