import { describe, expect, it } from 'vitest'
import {
  moduleFocusFromSearchParams,
  withoutModuleFocus,
} from './moduleFocus.js'

describe('module focus URL helpers', () => {
  it('parses item and filter-only navigation', () => {
    expect(
      moduleFocusFromSearchParams(
        new URLSearchParams('module=spotify&item=activeJam%23shire'),
      ),
    ).toEqual({
      type: 'spotify',
      itemId: 'activeJam#shire',
      token: 'spotify:activeJam#shire',
    })
    expect(
      moduleFocusFromSearchParams(new URLSearchParams('module=tv')),
    ).toEqual({ type: 'tv', itemId: null, token: 'tv:filter' })
  })

  it('removes only module navigation parameters', () => {
    const remaining = withoutModuleFocus(
      new URLSearchParams('module=requests&item=req-1&updateStatus=1'),
    )
    expect(remaining.toString()).toBe('updateStatus=1')
  })
})
