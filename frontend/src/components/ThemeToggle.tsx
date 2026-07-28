// frontend/src/components/ThemeToggle.tsx
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext";

export function ModeToggle() {
  const { theme, setTheme } = useTheme();

  const isDark = theme === "dark" || (
    theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches
  )

  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark");
  };

  return (
    <button
      onClick={toggleTheme}
      className="icon-button"
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      title={`Switch to ${isDark ? "light" : "dark"} theme`}
    >
      {isDark ? (
        <Sun size={18} />
      ) : (
        <Moon size={18} />
      )}
    </button>
  );
}
