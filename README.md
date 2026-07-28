# Anu Tailoring

Anu Tailoring is a React and TypeScript customer UI backed by a Python FastAPI API and PostgreSQL.

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

3. In Secret Manager, create:

   - `anu-tailoring-database-url`
   - `anu-tailoring-secret-key`

   The database URL should use the async PostgreSQL driver and URL-encode any
   special characters in the password:

   ```text
   postgresql+asyncpg://USER:PASSWORD@/DATABASE?host=/cloudsql/PROJECT:REGION:INSTANCE
   ```

4. Grant the Cloud Run service account access to both secrets and the
   **Cloud SQL Client** role.

### Deploy

In PowerShell:

```powershell
$env:GCP_PROJECT="YOUR_PROJECT_ID"
$env:GCP_REGION="asia-south1"
$env:GCP_CLOUD_SQL_INSTANCE="PROJECT:REGION:INSTANCE"

.\deploy-gcp.cmd `
  --set-secrets=DATABASE_URL=anu-tailoring-database-url:1,SECRET_KEY=anu-tailoring-secret-key:1
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
