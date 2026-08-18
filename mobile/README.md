# Vastrivo mobile

The Android and iOS client is an Expo/React Native application that uses the
existing FastAPI, PostgreSQL, GCS, routing, email, WebSocket, and Razorpay
backend. No backend secret belongs in this directory.

## What is implemented

- Customer registration, login, password-reset request, secure session restore,
  rotating device-bound refresh tokens, automatic refresh, and logout.
- Light/dark native design system, designs/products discovery, vendor directory,
  favorites, storefront details, custom-order entry, buyer orders, and order
  details.
- Native Razorpay checkout for invoice/final-payment actions while FastAPI still
  creates the provider order and verifies the payment signature/capture.
- Profile editing and a private profile-photo upload through FastAPI.
- Customer vendor application, vendor overview, native design draft/edit,
  1–10 image selection/upload (5 MB each), and administrator-review submission.
- Delivery-agent assignments, explicit foreground location sharing, route launch,
  and guarded booked → picked up → in transit → delivered actions.

Large administration/moderation tables remain web-first. Product inventory
editing, measurement/address editors, full cart composition, live order chat,
push registration, and offline upload recovery are still on the mobile roadmap.

## Local prerequisites

- Node.js 20.19.4 or newer.
- Android Studio with Android 16/API 36, Android SDK Build-Tools,
  Platform-Tools/ADB, Command-line Tools, and an emulator for local Android
  builds. Set `ANDROID_HOME` to the SDK directory and add
  `%ANDROID_HOME%\platform-tools` to the Windows user `Path`.
- macOS with Xcode for local iOS builds, or an Expo account for EAS cloud builds
  from Windows.
- The repository backend running locally or the deployed `https://vastrivo.in`
  API.

Razorpay is a native module, so this application requires a development build.
It will not run correctly inside the generic Expo Go application.

## Install and check

From the repository root:

In Windows Command Prompt:

```cmd
cd mobile
npm.cmd install
copy .env.example .env.local
npm.cmd run check
```

In PowerShell, use `Copy-Item .env.example .env.local` instead of `copy`.

Set `EXPO_PUBLIC_API_URL` in the ignored `.env.local`:

- Android emulator: `http://10.0.2.2:8000`
- iOS simulator: `http://127.0.0.1:8000`
- Physical phone: your computer's reachable LAN URL, for example
  `http://192.168.1.20:8000`
- Deployed backend: `https://vastrivo.in`

Only this public API origin is exposed to the application. Never add
`RAZORPAY_KEY_SECRET`, database credentials, service-account JSON, Resend keys,
JWT secrets, or GCP secrets to an `EXPO_PUBLIC_*` variable.

## Run Android

Start FastAPI first, then from the repository root run:

```powershell
npm.cmd run mobile:android
```

The first run generates an ignored `mobile/android/` project, compiles the
development client, installs it on the selected emulator/device, and starts
Metro. Later JavaScript-only changes can use:

```powershell
npm.cmd run mobile:start
```

## Run iOS

On macOS with Xcode:

```bash
npm run mobile:ios
```

On Windows, create an EAS development build instead:

```powershell
cd mobile
npx.cmd eas-cli login
npx.cmd eas-cli init
npx.cmd eas-cli build --profile development --platform ios
```

Install the resulting build on a registered test device, then run
`npm.cmd run start` to connect it to Metro.

## Preview and production builds

After confirming the permanent application identifier `in.vastrivo.app` and
running `eas init` once:

```powershell
cd mobile
npx.cmd eas-cli build --profile preview --platform all
npx.cmd eas-cli build --profile production --platform android
npx.cmd eas-cli build --profile production --platform ios
```

The EAS profiles point preview/production builds to `https://vastrivo.in`.
Android signing and Apple distribution credentials are managed by EAS or by
your store accounts; do not commit them.

Before publishing, complete these manual platform steps:

1. Create Google Play Console and Apple Developer/App Store Connect apps using
   `in.vastrivo.app`.
2. Add final app icon, adaptive icon, splash artwork, screenshots, privacy/data
   disclosures, support URL, account-deletion flow, and review credentials.
3. Run `eas credentials` and confirm release signing/Apple capabilities.
4. Host `/.well-known/assetlinks.json` and
   `/.well-known/apple-app-site-association` on `vastrivo.in` before enabling
   verified universal/app links publicly.
5. Test Razorpay success, failure, dismissal, webhooks, refunds, and a small live
   payment on physical Android and iOS devices before store release.

## Why Expo SDK 54 is pinned

Razorpay's current React Native wrapper is reported as unsupported on React
Native's mandatory New Architecture. Expo SDK 54 is the final Expo release that
can run the legacy architecture, so `newArchEnabled` is intentionally `false`.
Re-evaluate and upgrade once Razorpay officially supports the New Architecture;
do not silently move this project to Expo SDK 55+ beforehand.
