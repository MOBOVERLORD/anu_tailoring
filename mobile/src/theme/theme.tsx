import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { createThemeStorage, resolveTheme, type ThemePreference } from "./preference"
import { useColorScheme } from "react-native"

const light = {
  background: "#F8F4EE",
  surface: "#FFFDF9",
  surfaceMuted: "#F1E9E0",
  text: "#1D1815",
  muted: "#716761",
  border: "#DED3C8",
  primary: "#B84F2E",
  primarySoft: "#F4D6C8",
  success: "#2D7D5B",
  danger: "#B43C3C",
  white: "#FFFFFF",
}

const dark = {
  background: "#12100F",
  surface: "#1D1917",
  surfaceMuted: "#28211E",
  text: "#FFF8F2",
  muted: "#B9AEA7",
  border: "#443A35",
  primary: "#E47C55",
  primarySoft: "#4B2A20",
  success: "#73C99D",
  danger: "#F08D8D",
  white: "#FFFFFF",
}

export type AppColors = typeof light

interface ThemeContextValue {
  colors: AppColors
  dark: boolean
  preference: ThemePreference
  ready: boolean
  setPreference: (preference: ThemePreference) => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const storage = createThemeStorage(AsyncStorage)

export const ThemeProvider = ({ children }: PropsWithChildren) => {
  const system = useColorScheme()
  const [preference, updatePreference] = useState<ThemePreference>("system")
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let current = true
    storage.load().then((value) => { if (current) updatePreference(value) })
      .catch(() => { /* Use the system theme without overwriting an unreadable preference. */ })
      .finally(() => { if (current) setReady(true) })
    return () => { current = false }
  }, [])
  const isDark = resolveTheme(preference, system)
  const value = useMemo(() => ({
    colors: isDark ? dark : light,
    dark: isDark,
    preference,
    ready,
    setPreference: async (next: ThemePreference) => {
      await storage.save(next)
      updatePreference(next)
    },
  }), [isDark, preference, ready])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => {
  const value = useContext(ThemeContext)
  if (!value) throw new Error("useTheme must be used inside ThemeProvider")
  return value
}
