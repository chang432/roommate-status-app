import '@testing-library/jest-dom/vitest'

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// jsdom ships no PointerEvent, so fireEvent.pointerDown/Up fall back to a
// generic Event and silently drop clientX/clientY — every coordinate-based
// gesture then reads undefined and computes NaN deltas. MouseEvent does carry
// coordinates, so a thin subclass restores real-browser behavior for the swipe
// and drag tests.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEvent extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
      this.pointerType = params.pointerType ?? ''
      this.isPrimary = params.isPrimary ?? true
      this.pressure = params.pressure ?? 0
      this.width = params.width ?? 1
      this.height = params.height ?? 1
    }
  }
  window.PointerEvent = PointerEvent
  globalThis.PointerEvent = PointerEvent
}
