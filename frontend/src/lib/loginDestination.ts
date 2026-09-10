/** Only allow local app paths; never redirect sign-in to an external site. */
export function loginDestination(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || Array.from(value).some((character) => character === "\\" || character.charCodeAt(0) <= 32)) return "/"
  const path = value.split(/[?#]/)[0]
  if (["/login", "/register", "/forgot-password", "/reset-password"].includes(path)) return "/"
  return value
}
