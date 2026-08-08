import { spawnSync } from "node:child_process"

const showHelp = process.argv.includes("--help") || process.argv.includes("-h")
const extraArguments = process.argv.slice(2).filter((value) => value !== "--help" && value !== "-h")
// Retain the existing Cloud Run resource identifier during the customer-facing
// rebrand. Set GCP_SERVICE explicitly only when intentionally migrating it.
const service = process.env.GCP_SERVICE || "anu-tailoring"
const region = process.env.GCP_REGION || "asia-south1"
const gcloudCommand = process.platform === "win32" ? "gcloud.cmd" : "gcloud"

function fail(message) {
  console.error(`\n[Vastrivo] ${message}\n`)
  process.exit(1)
}

function prepareCommand(command, args) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    }
  }
  return { command, args }
}

function capture(command, args) {
  const prepared = prepareCommand(command, args)
  const result = spawnSync(prepared.command, prepared.args, {
    encoding: "utf8",
    shell: false,
  })
  if (result.error || result.status !== 0) return ""
  return result.stdout.trim()
}

if (showHelp) {
  console.log(`
Deploy Vastrivo to Google Cloud Run

Usage:
  deploy-gcp.cmd [additional gcloud run deploy flags]
  npm.cmd run deploy:gcp -- [additional flags]

Required environment variables:
  GCP_DESIGN_BUCKET      Private design-image bucket name

Optional environment variables:
  GCP_PROJECT            Google Cloud project ID; defaults to gcloud config
  GCP_REGION             Cloud Run region; defaults to asia-south1
  GCP_SERVICE            Service name; defaults to anu-tailoring
  GCP_CLOUD_SQL_INSTANCE project:region:instance Cloud SQL connection name
  GCP_SERVICE_ACCOUNT    Cloud Run runtime service account email
  GCP_RESEND_SECRET      Secret Manager secret name containing the Resend API key
  PUBLIC_APP_URL         Public Cloud Run/custom-domain URL used in email links
  APP_NAME               Selected customer-facing brand name
  EMAIL_FROM_ADDRESS     Verified transactional sender address
  EMAIL_FROM_NAME        Sender name shown in email clients
  MAPS_PROVIDER          openstreetmap (default) or google
  OSM_NOMINATIM_URL      Production Nominatim-compatible endpoint
  OSM_ROUTING_URL        Production OSRM-compatible endpoint

Examples:
  set GCP_PROJECT=my-project
  set GCP_REGION=asia-south1
  set GCP_CLOUD_SQL_INSTANCE=my-project:asia-south1:tailoring-db
  deploy-gcp.cmd

The Cloud Run service must have DATABASE_URL and SECRET_KEY configured from
Secret Manager. See README.md for the one-time GCP setup.
`)
  process.exit(0)
}

if (!capture(gcloudCommand, ["--version"])) {
  fail("Google Cloud CLI was not found. Install it and run “gcloud auth login” first.")
}

const project = process.env.GCP_PROJECT
  || capture(gcloudCommand, ["config", "get-value", "project"])

if (!project || project === "(unset)") {
  fail("No GCP project is selected. Set GCP_PROJECT or run “gcloud config set project PROJECT_ID”.")
}

const designBucket = process.env.GCP_DESIGN_BUCKET
if (!designBucket) {
  fail("GCP_DESIGN_BUCKET is required. Set it to the private design-image bucket name before deploying.")
}

const deployArguments = [
  "run",
  "deploy",
  service,
  "--source",
  ".",
  "--project",
  project,
  "--region",
  region,
  "--allow-unauthenticated",
  "--port",
  "8080",
  "--timeout",
  "3600",
  "--session-affinity",
  "--update-env-vars",
  [
    "ENVIRONMENT=production",
    "SERVE_FRONTEND=true",
    `GCS_BUCKET_NAME=${designBucket}`,
    ...(process.env.APP_NAME ? [`APP_NAME=${process.env.APP_NAME}`] : []),
    ...(process.env.PUBLIC_APP_URL ? [`PUBLIC_APP_URL=${process.env.PUBLIC_APP_URL}`] : []),
    ...(process.env.EMAIL_FROM_ADDRESS ? [`EMAIL_FROM_ADDRESS=${process.env.EMAIL_FROM_ADDRESS}`] : []),
    ...(process.env.EMAIL_FROM_NAME ? [`EMAIL_FROM_NAME=${process.env.EMAIL_FROM_NAME}`] : []),
    ...(process.env.MAPS_PROVIDER ? [`MAPS_PROVIDER=${process.env.MAPS_PROVIDER}`] : []),
    ...(process.env.OSM_NOMINATIM_URL ? [`OSM_NOMINATIM_URL=${process.env.OSM_NOMINATIM_URL}`] : []),
    ...(process.env.OSM_ROUTING_URL ? [`OSM_ROUTING_URL=${process.env.OSM_ROUTING_URL}`] : []),
    ...(process.env.GCP_RESEND_SECRET ? ["EMAIL_PROVIDER=resend", "EMAIL_NOTIFICATIONS_ENABLED=true"] : []),
  ].join(","),
]

if (process.env.GCP_RESEND_SECRET) {
  deployArguments.push(
    "--update-secrets",
    `RESEND_API_KEY=${process.env.GCP_RESEND_SECRET}:latest`,
  )
}

if (process.env.GCP_CLOUD_SQL_INSTANCE) {
  deployArguments.push(
    "--add-cloudsql-instances",
    process.env.GCP_CLOUD_SQL_INSTANCE,
  )
}

if (process.env.GCP_SERVICE_ACCOUNT) {
  deployArguments.push("--service-account", process.env.GCP_SERVICE_ACCOUNT)
}

deployArguments.push(...extraArguments)

console.log(`
[Vastrivo] Deploying to Cloud Run
  Project: ${project}
  Region:  ${region}
  Service: ${service}
`)

const preparedDeploy = prepareCommand(gcloudCommand, deployArguments)
const result = spawnSync(preparedDeploy.command, preparedDeploy.args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  shell: false,
})

if (result.error) fail(result.error.message)
process.exit(result.status ?? 1)
