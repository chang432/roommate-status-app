import { act, cleanup, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePullToRefresh } from './usePullToRefresh.js'

function setWindowScrollY(top) {
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value: top,
  })
}

describe('usePullToRefresh', () => {
  beforeEach(() => {
    setWindowScrollY(0)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('ignores a primarily horizontal touch gesture', () => {
    const onRefresh = vi.fn()
    const { result } = renderHook(() => usePullToRefresh(onRefresh))

    fireEvent.touchStart(window, {
      touches: [{ clientX: 40, clientY: 100 }],
    })
    fireEvent.touchMove(window, {
      touches: [{ clientX: 180, clientY: 112 }],
    })
    fireEvent.touchEnd(window)

    expect(result.current.pull).toBe(0)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('still refreshes after a deliberate downward pull', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => usePullToRefresh(onRefresh))

    fireEvent.touchStart(window, {
      touches: [{ clientX: 40, clientY: 40 }],
    })
    fireEvent.touchMove(window, {
      touches: [{ clientX: 44, clientY: 180 }],
    })
    expect(result.current.pull).toBe(70)

    await act(async () => {
      fireEvent.touchEnd(window)
    })
    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
    expect(result.current.pull).toBe(0)
  })
})
