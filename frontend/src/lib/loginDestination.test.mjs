import test from "node:test"
import assert from "node:assert/strict"
import { loginDestination } from "./loginDestination.ts"
test("preserves local destinations including query and fragment", () => {
  assert.equal(loginDestination("/profile?section=addresses#saved"), "/profile?section=addresses#saved")
  assert.equal(loginDestination("/vendors/3"), "/vendors/3")
})
test("rejects external destinations and login loops", () => {
  for (const value of [null, "https://example.com", "//example.com", "/\\example.com", "/login?next=/cart", "/register", "/\nexample.com"]) assert.equal(loginDestination(value), "/")
})
