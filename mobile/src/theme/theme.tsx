import { createContext, type PropsWithChildren, useContext, useMemo, useState } from "react"
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
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export const ThemeProvider = ({ children }: PropsWithChildren) => {
  const system = useColorScheme()
  const [override, setOverride] = useState<"light" | "dark" | null>(null)
  const isDark = (override ?? system) === "dark"
  const value = useMemo(() => ({
    colors: isDark ? dark : light,
    dark: isDark,
    toggleTheme: () => setOverride((current) => (current ?? system) === "dark" ? "light" : "dark"),
  }), [isDark, system])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => {
  const value = useContext(ThemeContext)
  if (!value) throw new Error("useTheme must be used inside ThemeProvider")
  return value
}
