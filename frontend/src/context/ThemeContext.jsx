import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { isThemeId } from '../models/themes.js'

const ThemeContext = createContext(null)

function systemTheme() {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyBrowserTheme(resolvedTheme, preference) {
  const root = document.documentElement
  root.dataset.theme = resolvedTheme
  root.dataset.themePreference = preference

  // The CSS token is theme-owned so browser chrome follows future themes too.
  const browserColor = getComputedStyle(root)
    .getPropertyValue('--browser-theme-color')
    .trim()
  const meta = document.querySelector('meta[name="theme-color"]')
  if (browserColor && meta) meta.setAttribute('content', browserColor)
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState('system')
  const [resolvedTheme, setResolvedTheme] = useState(() => (
    theme === 'system' ? systemTheme() : theme
  ))

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')

    function applyTheme() {
      const nextResolved = theme === 'system'
        ? (media?.matches ? 'dark' : 'light')
        : theme
      setResolvedTheme(nextResolved)
      applyBrowserTheme(nextResolved, theme)
    }

    applyTheme()
    if (theme !== 'system' || !media) return undefined
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [theme])

  const value = useMemo(() => ({
    theme,
    resolvedTheme,
    setTheme(nextTheme) {
      const safeTheme = isThemeId(nextTheme) ? nextTheme : 'system'
      setThemeState(safeTheme)
    },
  }), [resolvedTheme, theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook colocated with provider
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
