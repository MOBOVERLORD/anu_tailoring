import test from "node:test"
import assert from "node:assert/strict"
import { expandGarmentPieces, resizePieceFits } from "./customOrderDraft.ts"

test("increasing quantity requires new fits without changing existing selections", () => {
  const fits = ["12", "13"]
  assert.deepEqual(resizePieceFits(fits, 3), ["12", "13", ""])
  assert.deepEqual(fits, ["12", "13"])
  assert.deepEqual(resizePieceFits(fits, 1), ["12"])
})
test("quantities are bounded whole pieces", () => {
  for (const quantity of [0, -1, 1.5, 21, NaN]) assert.throws(() => resizePieceFits([], quantity))
})
test("multiple garments preserve one design per entry and reusable per-piece fits", () => {
  const first = { fits: ["12", "12", "13"], designs: [7], photos: [], notes: "First garment" }
  const second = { fits: ["15"], designs: [], photos: ["photo-id"], notes: "Second garment" }
  const pieces = expandGarmentPieces([first, second])
  assert.equal(pieces.length, 4)
  assert.deepEqual(pieces.map((piece) => piece.measurementId), ["12", "12", "13", "15"])
  assert.deepEqual(pieces.map((piece) => piece.pieceNumber), [1, 2, 3, 1])
  assert.ok(pieces.slice(0, 3).every((piece) => piece.entry === first))
  assert.equal(pieces[3].entry, second)
})
