import { useEffect, useRef } from 'react'

export const LONG_PRESS_MS = 1000

const MOVE_TOLERANCE_PX = 10

// Shared pointer/keyboard long-press handling. Callers decide which descendants
// may start the gesture so controls nested beside a press target stay usable.
export function useLongPress({
  enabled,
  onLongPress,
  isPointerTarget,
  isKeyboardTarget,
  delay = LONG_PRESS_MS,
}) {
  const timerRef = useRef(null)
  const pointerRef = useRef(null)
  const keyboardTargetRef = useRef(null)
  const triggeredRef = useRef(false)
  const blockClickUntilRef = useRef(0)
  const onLongPressRef = useRef(onLongPress)
  onLongPressRef.current = onLongPress

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function resetGesture() {
    clearTimer()
    pointerRef.current = null
    keyboardTargetRef.current = null
    triggeredRef.current = false
  }

  function startTimer() {
    clearTimer()
    triggeredRef.current = false
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      triggeredRef.current = true
      // Mobile browsers may synthesize a click after the completed hold.
      blockClickUntilRef.current = Date.now() + 750
      onLongPressRef.current()
    }, delay)
  }

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (enabled || timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
    pointerRef.current = null
    keyboardTargetRef.current = null
    triggeredRef.current = false
  }, [enabled])

  function handlePointerDown(event) {
    if (
      !enabled ||
      (event.pointerType === 'mouse' && event.button !== 0) ||
      !isPointerTarget(event)
    ) {
      return
    }
    pointerRef.current = {
      id: event.pointerId,
      x: Number.isFinite(event.clientX) ? event.clientX : 0,
      y: Number.isFinite(event.clientY) ? event.clientY : 0,
    }
    startTimer()
  }

  function handlePointerMove(event) {
    const pointer = pointerRef.current
    if (!pointer || pointer.id !== event.pointerId || triggeredRef.current) return
    const clientX = Number.isFinite(event.clientX) ? event.clientX : pointer.x
    const clientY = Number.isFinite(event.clientY) ? event.clientY : pointer.y
    if (
      Math.abs(clientX - pointer.x) > MOVE_TOLERANCE_PX ||
      Math.abs(clientY - pointer.y) > MOVE_TOLERANCE_PX
    ) {
      resetGesture()
    }
  }

  function finishPointer(event) {
    if (pointerRef.current?.id !== event.pointerId) return
    clearTimer()
    pointerRef.current = null
  }

  function handleKeyDown(event) {
    if (
      !enabled ||
      event.repeat ||
      (event.key !== 'Enter' && event.key !== ' ') ||
      !isKeyboardTarget(event)
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    keyboardTargetRef.current = event.target
    startTimer()
  }

  function handleKeyUp(event) {
    if (
      keyboardTargetRef.current !== event.target ||
      (event.key !== 'Enter' && event.key !== ' ')
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    clearTimer()
    const wasTriggered = triggeredRef.current
    keyboardTargetRef.current = null
    triggeredRef.current = false
    if (!wasTriggered) event.target.click()
  }

  function handleClickCapture(event) {
    if (Date.now() >= blockClickUntilRef.current || !isPointerTarget(event)) return
    event.preventDefault()
    event.stopPropagation()
    blockClickUntilRef.current = 0
  }

  function handleContextMenu(event) {
    if (enabled && isPointerTarget(event)) event.preventDefault()
  }

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onPointerLeave: finishPointer,
    onKeyDownCapture: handleKeyDown,
    onKeyUpCapture: handleKeyUp,
    onClickCapture: handleClickCapture,
    onContextMenu: handleContextMenu,
  }
}
