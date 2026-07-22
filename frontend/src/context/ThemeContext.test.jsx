import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileSettings from '../components/profile/ProfileSettings.jsx'
import { ThemeProvider, useTheme } from './ThemeContext.jsx'

function ThemeProbe() {
  const { theme, resolvedTheme } = useTheme()
  return <output>{theme}:{resolvedTheme}</output>
}

function installMatchMedia(initiallyDark = false) {
  let matches = initiallyDark
  const listeners = new Set()
  window.matchMedia = vi.fn(() => ({
    get matches() {
      return matches
    },
    addEventListener: (_event, listener) => listeners.add(listener),
    removeEventListener: (_event, listener) => listeners.delete(listener),
  }))
  return {
    setDark(nextMatches) {
      matches = nextMatches
      listeners.forEach((listener) => listener({ matches }))
    },
  }
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-preference')
    document.head.innerHTML = '<meta name="theme-color" content="#b3613f">'
    installMatchMedia(false)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => ({
      getPropertyValue: (property) => (
        property === '--browser-theme-color'
          ? ({ light: '#b3613f', dark: '#3b251d', forest: '#143d2e' }[element.dataset.theme] ?? '')
          : ''
      ),
    }))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('applies and persists a named theme without consulting system changes', async () => {
    localStorage.setItem('roomie-theme', 'forest')
    const media = installMatchMedia(false)
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)

    expect(await screen.findByText('forest:forest')).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'forest')
    expect(document.documentElement).toHaveAttribute('data-theme-preference', 'forest')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#143d2e',
    )

    media.setDark(true)
    expect(screen.getByText('forest:forest')).toBeInTheDocument()
  })

  it('falls back to System and follows operating-system changes', async () => {
    localStorage.setItem('roomie-theme', 'unknown-theme')
    const media = installMatchMedia(false)
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)

    expect(await screen.findByText('system:light')).toBeInTheDocument()
    media.setDark(true)
    expect(await screen.findByText('system:dark')).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#3b251d',
    )
  })

  it('renders theme choices from the catalog and saves Forest', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <ProfileSettings
          user={{ id: 'andre', name: 'Andre', username: 'andre', hasGroup: false }}
          onSignOut={vi.fn()}
          onDeleteAccount={vi.fn()}
        />
      </ThemeProvider>,
    )

    expect(screen.getAllByRole('radio')).toHaveLength(4)
    await user.click(screen.getByRole('radio', { name: /Forest/ }))

    expect(localStorage.getItem('roomie-theme')).toBe('forest')
    expect(document.documentElement).toHaveAttribute('data-theme', 'forest')
    expect(screen.getByText('Current theme: Forest')).toBeInTheDocument()
  })
})
