import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"

const require = createRequire(new URL("../mobile/package.json", import.meta.url))
const ts = require("typescript")
const source = readFileSync(new URL("../mobile/src/lib/api.ts", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const key = "vastrivo.mobile.refresh"
function harness(fetch, storage = new Map([[key, "original-refresh"], ["vastrivo.mobile.device", "device-id"]])) {
  const exports = {}
  const context = { exports, process: { env: {} }, fetch, FormData, require: (name) => {
    if (name === "expo-secure-store") return {
      getItemAsync: async (key) => storage.get(key) || null,
      setItemAsync: async (key, value) => { storage.set(key, value) },
      deleteItemAsync: async (key) => { storage.delete(key) },
    }
    if (name === "expo-crypto") return { randomUUID: () => "92b6cb94-81bc-43dc-963b-0123456789ab" }
    throw new Error(`Unexpected import ${name}`)
  } }
  vm.runInNewContext(compiled, context)
  return { api: exports, storage }
}
const response = (status, body) => new Response(JSON.stringify(body), { status })
const tokens = { access_token: "new-access", refresh_token: "rotated-refresh" }

for (const status of [429, 500, 503]) {
  const { api, storage } = harness(async () => response(status, { detail: "Temporary failure" }))
  await assert.rejects(api.restoreMobileSession())
  assert.equal(storage.get(key), "original-refresh")
}
{
  const { api, storage } = harness(async () => { throw new TypeError("Offline") })
  await assert.rejects(api.restoreMobileSession())
  assert.equal(storage.get(key), "original-refresh")
}
{
  const { api, storage } = harness(async () => response(401, { detail: "Revoked" }))
  await assert.rejects(api.restoreMobileSession(), api.SessionRejectedError)
  assert.equal(storage.has(key), false)
}
{
  let calls = 0
  const { api, storage } = harness(async () => { calls++; return response(200, tokens) })
  await Promise.all([api.restoreMobileSession(), api.restoreMobileSession(), api.restoreMobileSession()])
  assert.equal(calls, 1)
  assert.equal(storage.get(key), "rotated-refresh")
  assert.equal(api.currentAccessToken(), "new-access")
}
{
  let calls = 0
  const { api, storage } = harness(async () => { calls++; return response(200, tokens) })
  storage.delete(key)
  await assert.rejects(api.restoreMobileSession(), api.SessionRejectedError)
  assert.equal(calls, 0)
}
{
  let failures = 0
  const { api, storage } = harness(async (url) => url.endsWith("/refresh") ? response(503, {}) : response(401, {}))
  await api.saveMobileSession(tokens)
  api.setAuthFailureHandler(() => { failures++ })
  await assert.rejects(api.api("/api/auth/me"))
  assert.equal(failures, 0)
  assert.equal(storage.get(key), "rotated-refresh")
}
{
  let requests = 0
  let failures = 0
  const { api, storage } = harness(async (url) => {
    if (url.endsWith("/refresh")) return response(200, tokens)
    requests++
    return response(401, {})
  })
  await api.saveMobileSession(tokens)
  api.setAuthFailureHandler(() => { failures++ })
  await assert.rejects(api.api("/api/auth/me"), api.SessionRejectedError)
  assert.equal(requests, 2)
  assert.equal(failures, 1)
  assert.equal(storage.has(key), false)
}
{
  const requests = []
  let lost = true
  const fetch = async (_, init) => {
    requests.push(JSON.parse(init.body))
    if (lost) throw new TypeError("Response lost")
    return response(200, tokens)
  }
  const { api, storage } = harness(fetch)
  await assert.rejects(api.restoreMobileSession())
  assert.ok(storage.has("vastrivo.mobile.refresh.pending.v1"))
  lost = false
  // A fresh module has no in-memory access token or pending request state.
  await harness(fetch, storage).api.restoreMobileSession()
  assert.deepEqual(requests[0], requests[1])
  assert.equal(storage.has("vastrivo.mobile.refresh.pending.v1"), false)
}
console.log("Mobile session regression passed: transient errors retain credentials, rejection clears them, refresh is single-flight, requests retry only once, and lost responses reuse the persisted request ID.")
