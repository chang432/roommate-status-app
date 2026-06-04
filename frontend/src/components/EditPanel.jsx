import { useEffect, useRef, useState } from 'react'
import StatusDot from './StatusDot.jsx'
import { STATUS } from '../utils/status.js'

// Editor for your own status. Lets you pick available / busy, or type a custom
// message, then save. Initialized from the roommate's current status so editing
// is non-destructive until "Save" is pressed.
export default function EditPanel({ roommate, onSave, onCancel, saving }) {
  const [status, setStatus] = useState(roommate.status)
  const [custom, setCustom] = useState(
    roommate.status === STATUS.CUSTOM ? roommate.statusText : '',
  )
  const customInputRef = useRef(null)

  // Focus the custom field as soon as the custom option becomes active.
  useEffect(() => {
    if (status === STATUS.CUSTOM) customInputRef.current?.focus()
  }, [status])

  function handleSave() {
    onSave(status, status === STATUS.CUSTOM ? custom.trim() : '')
  }

  const choiceBase =
    'flex w-full items-center gap-[11px] rounded-sm border-[1.5px] px-[15px] py-[13px] text-left text-[15px] font-semibold text-ink transition'
  const choiceClass = (value) =>
    `${choiceBase} ${
      status === value
        ? 'border-accent bg-accent-soft'
        : 'border-line bg-white hover:border-[#d9c9b3]'
    }`

  return (
    <div className="mb-[26px] rounded-md border border-line bg-card p-5 shadow-soft">
      <h3 className="mb-[14px] font-display text-[16px] font-semibold">Set your status</h3>

      <button type="button" className={`${choiceClass(STATUS.AVAILABLE)} mb-[10px]`} onClick={() => setStatus(STATUS.AVAILABLE)}>
        <StatusDot status={STATUS.AVAILABLE} /> Available to hang
      </button>

      <button type="button" className={`${choiceClass(STATUS.BUSY)} mb-[10px]`} onClick={() => setStatus(STATUS.BUSY)}>
        <StatusDot status={STATUS.BUSY} /> Busy with something
      </button>

      <label className={`${choiceClass(STATUS.CUSTOM)} mb-[10px] cursor-text`}>
        <StatusDot status={STATUS.CUSTOM} />
        <input
          ref={customInputRef}
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onFocus={() => setStatus(STATUS.CUSTOM)}
          placeholder="Custom message…"
          className="flex-1 border-none bg-transparent text-[14px] text-ink outline-none placeholder:text-[#b6a995]"
        />
      </label>

      <div className="mt-[6px] flex gap-[10px]">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 rounded-sm bg-accent py-[13px] text-[15px] font-bold text-white transition hover:bg-accent-deep disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save status'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-sm border-[1.5px] border-line bg-white px-[18px] py-[13px] text-[15px] font-bold text-ink-soft transition hover:bg-[#faf6ef] disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
