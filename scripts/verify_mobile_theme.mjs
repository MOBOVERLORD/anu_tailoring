import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"

const require = createRequire(new URL("../mobile/package.json", import.meta.url))
const ts = require("typescript")
const source = readFileSync(new URL("../mobile/src/theme/preference.ts", import.meta.url), "utf8")
const exports = {}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports })
const { createThemeStorage, THEME_KEY, normalizeTheme, resolveTheme } = exports
assert.equal(THEME_KEY, "vastrivo.mobile.theme.v1")
for (const value of [null, undefined, "", "old", "DARK", {}, 1]) assert.equal(normalizeTheme(value), "system")
for (const preference of ["system", "light", "dark"]) {
  const values = new Map()
  const storage = { getItem: async (key) => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value) } }
  await createThemeStorage(storage).save(preference)
  assert.equal(await createThemeStorage(storage).load(), preference)
}
assert.equal(resolveTheme("system", "dark"), true)
assert.equal(resolveTheme("system", "light"), false)
assert.equal(resolveTheme("system", null), false)
assert.equal(resolveTheme("light", "dark"), false)
assert.equal(resolveTheme("dark", "light"), true)
{
  const saved = []
  const storage = createThemeStorage({ getItem: async () => null, setItem: async (_, value) => { await new Promise((resolve) => setTimeout(resolve, value === "dark" ? 10 : 0)); saved.push(value) } })
  await Promise.all([storage.save("dark"), storage.save("light"), storage.save("system")])
  assert.deepEqual(saved, ["dark", "light", "system"])
}
{
  let fail = true
  let saved
  const storage = createThemeStorage({ getItem: async () => { throw new Error("Unavailable") }, setItem: async (_, value) => { if (fail) throw new Error("Full"); saved = value } })
  await assert.rejects(storage.load())
  await assert.rejects(storage.save("dark"))
  fail = false
  await storage.save("light")
  assert.equal(saved, "light")
}
console.log("Theme storage regression passed: restore, system resolution, invalid values, ordered writes, and storage failure recovery.")
