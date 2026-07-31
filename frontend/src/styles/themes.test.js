import { readFileSync } from 'node:fs'
import { cwd } from 'node:process'
import { describe, expect, it } from 'vitest'
import { FEED_MODULE_REGISTRY } from '../components/feed/feedModuleRegistry.jsx'
import { THEME_DEFINITIONS } from '../models/themes.js'

const css = readFileSync(`${cwd()}/src/styles/themes.css`, 'utf8')

function themeTokens(themeId) {
  const marker = `:root[data-theme='${themeId}'] {`
  const start = css.indexOf(marker)
  if (start === -1) return null
  const bodyStart = start + marker.length
  const bodyEnd = css.indexOf('\n}', bodyStart)
  const declarations = css.slice(bodyStart, bodyEnd)
  return Object.fromEntries(
    [...declarations.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)]
      .map(([, name, value]) => [name, value.trim()]),
  )
}

function hslToRgb(value) {
  const match = value.match(/^(\d+)\s+(\d+)%\s+(\d+)%$/)
  if (!match) throw new Error(`Expected an HSL triplet, received ${value}`)
  const [, hueValue, saturationValue, lightnessValue] = match
  const hue = Number(hueValue) / 360
  const saturation = Number(saturationValue) / 100
  const lightness = Number(lightnessValue) / 100
  if (saturation === 0) return [lightness, lightness, lightness]
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const channel = (offset) => {
    let position = hue + offset
    if (position < 0) position += 1
    if (position > 1) position -= 1
    if (position < 1 / 6) return p + (q - p) * 6 * position
    if (position < 1 / 2) return q
    if (position < 2 / 3) return p + (q - p) * (2 / 3 - position) * 6
    return p
  }
  return [channel(1 / 3), channel(0), channel(-1 / 3)]
}

function contrast(first, second) {
  const luminance = (value) => {
    const channels = hslToRgb(value).map((channel) => (
      channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    ))
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const lighter = Math.max(luminance(first), luminance(second))
  const darker = Math.min(luminance(first), luminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('theme token contract', () => {
  const selectableThemes = THEME_DEFINITIONS.filter(({ id }) => id !== 'system')
  const lightTokenNames = Object.keys(themeTokens('light')).sort()

  it.each(selectableThemes)('$label defines the complete token set', ({ id }) => {
    expect(Object.keys(themeTokens(id) ?? {}).sort()).toEqual(lightTokenNames)
  })

  it.each(selectableThemes)('$label keeps primary and module text readable', ({ id }) => {
    const tokens = themeTokens(id)
    expect(contrast(tokens['--color-ink'], tokens['--color-card'])).toBeGreaterThanOrEqual(4.5)
    Object.keys(FEED_MODULE_REGISTRY).forEach((moduleId) => {
      expect(contrast(
        tokens[`--color-module-${moduleId}-text`],
        tokens[`--color-module-${moduleId}-bg`],
      )).toBeGreaterThanOrEqual(4.5)
    })
  })

  it.each([
    ['Dark', 'dark', '0 0% 100%'],
    ['Forest', 'forest', '52 60% 98%'],
  ])('keeps %s foregrounds readable on every solid surface', (_, themeId, foreground) => {
    const tokens = themeTokens(themeId)
    const strongBackgrounds = [
      'solid-accent',
      'solid-accent-hover',
      'solid-success',
      'solid-danger',
      'solid-danger-hover',
      'solid-neutral',
      'solid-pending',
      'avatar-1',
      'avatar-2',
      'avatar-3',
      'avatar-4',
      'avatar-5',
      'avatar-6',
    ]

    expect(tokens['--color-on-strong']).toBe(foreground)
    strongBackgrounds.forEach((name) => {
      expect(contrast(
        tokens['--color-on-strong'],
        tokens[`--color-${name}`],
      )).toBeGreaterThanOrEqual(4.5)
    })
  })
})
