import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import '@fontsource-variable/fraunces'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './context/ThemeContext.tsx'

const themeStorageKey = 'vastrivo-theme'
const legacyTheme = localStorage.getItem('anu-tailoring-theme')
if (!localStorage.getItem(themeStorageKey) && legacyTheme) {
  localStorage.setItem(themeStorageKey, legacyTheme)
  localStorage.removeItem('anu-tailoring-theme')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey={themeStorageKey}>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
