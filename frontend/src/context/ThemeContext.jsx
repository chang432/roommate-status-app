import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

const THEME_KEY = 'roomie-theme'
const THEME_OPTIONS = ['system', 'light', 'dark']
const ThemeContext = createContext(null)

function safeStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return THEME_OPTIONS.includes(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

function systemTheme() {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(safeStoredTheme)
  const [resolvedTheme, setResolvedTheme] = useState(() => (
    theme === 'system' ? systemTheme() : theme
  ))

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    function applyTheme() {
      const nextResolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      setResolvedTheme(nextResolved)
      document.documentElement.dataset.theme = nextResolved
      document.documentElement.dataset.themePreference = theme
      document.documentElement.style.colorScheme = nextResolved
    }

    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [theme])

  const value = useMemo(() => ({
    theme,
    resolvedTheme,
    setTheme(nextTheme) {
      const safeTheme = THEME_OPTIONS.includes(nextTheme) ? nextTheme : 'system'
      setThemeState(safeTheme)
      try {
        localStorage.setItem(THEME_KEY, safeTheme)
      } catch {
        // The selected theme still applies for this session if storage is unavailable.
      }
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
