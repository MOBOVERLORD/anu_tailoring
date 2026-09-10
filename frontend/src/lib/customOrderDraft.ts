/** Retain existing selections; new pieces must have an explicitly chosen fit. */
export function resizePieceFits(fits: string[], quantity: number): string[] {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error("Choose a quantity between 1 and 20.")
  return Array.from({ length: quantity }, (_, index) => fits[index] || "")
}

/** Expand quantity into independently measured pieces for the existing order API. */
export function expandGarmentPieces<T extends { fits: string[] }>(entries: T[]) {
  return entries.flatMap((entry) => entry.fits.map((measurementId, index) => ({ entry, measurementId, pieceNumber: index + 1 })))
}
