export type ThemePreference = "system" | "light" | "dark"
export const THEME_KEY = "vastrivo.mobile.theme.v1"
export const normalizeTheme = (value: unknown): ThemePreference => value === "light" || value === "dark" ? value : "system"
export const resolveTheme = (preference: ThemePreference, system: string | null | undefined) => (preference === "system" ? system : preference) === "dark"

export function createThemeStorage(storage: { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> }) {
  let writes = Promise.resolve()
  return {
    load: async () => normalizeTheme(await storage.getItem(THEME_KEY)),
    save: (preference: ThemePreference) => {
      const next = writes.then(() => storage.setItem(THEME_KEY, preference))
      writes = next.catch(() => undefined)
      return next
    },
  }
}
