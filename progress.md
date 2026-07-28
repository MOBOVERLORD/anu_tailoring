# Anu Tailoring — Progress

Last updated: 2026-07-28

## Current milestone

The initial customer account experience is implemented across the React frontend and FastAPI backend.

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

1. Add Alembic migrations before moving beyond the early development schema.
2. Add design administration/seed data so the catalog can be exercised with real cards and imagery.
3. Add per-measurement “how to measure” guidance and diagrams.
4. Add backend/frontend automated tests for profile, measurement, address, and favorite flows.
5. Begin the garment customization and order flow after the catalog data model is finalized.

## Resume prompt

“Continue from `progress.md`. Start with the next milestone, preserve the current warm editorial UI and both themes, and update `progress.md` when done.”
