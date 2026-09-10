export interface GarmentDraft {
  fits: string[]; designs: number[]; photos: string[]; notes: string
  cloth: "customer_provided" | "vendor_supplied"; colour: string; fabric: string
}
export function resizeFits(fits: string[], quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error("Quantity must be 1–20.")
  return Array.from({ length: quantity }, (_, i) => fits[i] || "")
}
export function orderPieces(entries: GarmentDraft[], designId: number) {
  const count = entries.reduce((sum, item) => sum + item.fits.length, 0)
  if (!count || count > 20) throw new Error("An order supports 1–20 pieces.")
  return entries.flatMap((entry) => {
    if (!entry.fits.length || entry.notes.trim().length < 10 || entry.designs.length + entry.photos.length > 1) throw new Error("Complete each garment with at most one design reference.")
    return entry.fits.map((fit, index) => {
      if (!Number.isInteger(Number(fit)) || Number(fit) <= 0) throw new Error("Choose measurements for every piece.")
      return { design_id: designId, measurement_profile_id: Number(fit), cloth_source: entry.cloth, colour_preference: entry.cloth === "vendor_supplied" ? entry.colour.trim() || null : null, reference_design_ids: entry.designs, reference_photo_ids: entry.photos, fabric_choice: entry.fabric.trim() || null, custom_instructions: entry.notes.trim() + (entry.fits.length > 1 ? `\n(Piece ${index + 1} of ${entry.fits.length}, same design)` : "") }
    })
  })
}
