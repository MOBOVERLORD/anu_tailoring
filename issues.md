# Issues

Order colour/custom reference follow-up: verify real GCS upload, remove/retry,
vendor design selection, explicit fit selection and customer/vendor order detail
display in both themes on browser and Android/iOS. Backend regression uses mocked
storage download and delivery quoting; it does not exercise live GCS or delivery.
Unattached uploaded photos currently remain private in storage; automatic cleanup
of abandoned drafts needs a retention policy and cleanup job.

Functional automated checks pass. Mobile dependency audit reports 31 findings
(21 moderate, 10 high) on 8 September 2026, including Expo tooling/transitive
dependencies. Review remediation separately; no forced SDK upgrades were applied.

Feature #10 remains in progress. Transient session-error regression and native
type/config checks pass; verify offline startup/retry, revoked credentials and
logout on Android/iOS. Durable server session lifetime and recovery after a lost
refresh response are implemented; rollback-only backend and simulated process
restart regressions pass on 9 September. Fresh migrations and model checks pass.
Real-device lifecycle/security verification remains pending. Theme persistence and its storage
tests pass. Rebuild the native app for AsyncStorage/splash dependencies, then verify
system/light/dark selection, live OS changes, restarts, upgrades and startup flashing
on Android/iOS. No device lifecycle or visual verification has been performed.

Web customer/measurement parity follow-up: exercise search, pagination, link/invite,
private notes, measurement CRUD, unit conversion and accepted-customer read-only
fits at desktop/mobile widths in both themes. Build and lint passed on 8 September
2026; interactive browser QA was not performed. Existing bundle-size and Fast
Refresh warnings remain non-blocking.

Feature #4 verification follow-up: exercise add/edit/delete, keyboard access and
unit switching on Android/iOS in both themes. Automated native type/config,
ownership/consent regression, existing relationship regression, fresh migrations
and model-drift checks passed on 8 September 2026; device UI was not exercised.
