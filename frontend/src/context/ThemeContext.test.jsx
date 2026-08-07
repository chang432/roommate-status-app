import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from './ThemeContext.jsx'

function ThemeProbe() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  return <><output>{theme}:{resolvedTheme}</output><button onClick={() => setTheme('forest')}>Use Forest</button></>
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

  it('applies an explicit group theme without persisting a global preference', async () => {
    const media = installMatchMedia(false)
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)

    await userEvent.click(screen.getByRole('button', { name: 'Use Forest' }))

    expect(await screen.findByText('forest:forest')).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'forest')
    expect(document.documentElement).toHaveAttribute('data-theme-preference', 'forest')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#143d2e',
    )
    expect(localStorage.getItem('roomie-theme')).toBeNull()

    media.setDark(true)
    expect(screen.getByText('forest:forest')).toBeInTheDocument()
  })

  it('falls back to System and follows operating-system changes', async () => {
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

})
