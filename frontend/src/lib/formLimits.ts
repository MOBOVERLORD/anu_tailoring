export const boundedNumber = (rawValue: string, minimum: number, maximum: number) => {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed)) return maximum
  return Math.min(maximum, Math.max(minimum, parsed))
}

export const validMeasurementInput = (rawValue: string, maximum = 300) => {
  if (rawValue === "") return true
  if (!/^\d{0,3}(?:\.\d?)?$/.test(rawValue)) return false
  const parsed = Number(rawValue)
  return Number.isFinite(parsed) && parsed <= maximum
}
