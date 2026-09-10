import test from "node:test"
import assert from "node:assert/strict"
import { orderPieces, resizeFits } from "./customOrderDraft.ts"
const draft = { fits: ["1", "1", "2"], designs: [9], photos: [], notes: "A cotton kurta", cloth: "vendor_supplied", colour: " Navy ", fabric: "Cotton" }
test("quantity retains fits and leaves new pieces unselected", () => {
  assert.deepEqual(resizeFits(["1"], 3), ["1", "", ""])
  assert.deepEqual(resizeFits(["1", "2"], 1), ["1"])
  for (const quantity of [0, 21, 1.2]) assert.throws(() => resizeFits([], quantity))
})
test("batch shares design references but keeps independent measurements", () => {
  const lines = orderPieces([draft, { ...draft, fits: ["3"], designs: [], photos: ["photo"], cloth: "customer_provided" }], 17)
  assert.deepEqual(lines.map((item) => item.measurement_profile_id), [1, 1, 2, 3])
  assert.ok(lines.every((item) => item.design_id === 17))
  assert.equal(lines[0].colour_preference, "Navy")
  assert.equal(lines[3].colour_preference, null)
  assert.deepEqual(lines[3].reference_photo_ids, ["photo"])
})
test("rejects missing fits, excessive quantity and mixed references", () => {
  for (const entry of [{ ...draft, fits: [""] }, { ...draft, fits: Array(21).fill("1") }, { ...draft, photos: ["photo"] }]) assert.throws(() => orderPieces([entry], 17))
})
