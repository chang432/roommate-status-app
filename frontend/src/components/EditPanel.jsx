import { useState } from 'react'
import StatusDot from './StatusDot.jsx'
import { STATUS_ORDER, STATUS_LABEL } from '../utils/status.js'

// Editor for your own status. Pick one of the fixed statuses and, below each
// title, optionally add a supplemental note for that status. Only the selected
// status's note is saved and shown to everyone. Notes are tracked per status so
// switching between options is non-destructive until "Save" is pressed.
export default function EditPanel({ roommate, onSave, onCancel, saving }) {
  const [status, setStatus] = useState(roommate.status)
  // Map of status -> note text. Only the currently-saved status has stored
  // text, so seed just that slot; every other field starts empty.
  const [notes, setNotes] = useState(() => ({
    [roommate.status]: roommate.statusText || '',
  }))

  function setNote(value) {
    setNotes((prev) => ({ ...prev, [status]: value }))
  }

  function handleSave() {
    // Persist the note belonging to the selected status (others are discarded).
    onSave(status, (notes[status] || '').trim())
  }

  const panelClass = (value) =>
    `rounded-sm border-[1.5px] px-[15px] py-[13px] transition ${
      status === value
        ? 'border-accent bg-accent-soft'
        : 'border-line bg-white hover:border-[#d9c9b3]'
    }`

  return (
    <div className="mb-[26px] rounded-md border border-line bg-card p-5 shadow-soft">
      <h3 className="mb-[14px] font-display text-[16px] font-semibold">Set your status</h3>

      {STATUS_ORDER.map((value) => (
        <div key={value} className={`${panelClass(value)} mb-[10px]`}>
          <button
            type="button"
            onClick={() => setStatus(value)}
            className="flex w-full items-center gap-[11px] text-left text-[15px] font-semibold text-ink"
          >
            <StatusDot status={value} /> {STATUS_LABEL[value]}
          </button>
          <input
            type="text"
            value={notes[value] || ''}
            onChange={(e) => setNote(e.target.value)}
            // Typing in a field selects that status so the note you write is the
            // one that gets saved.
            onFocus={() => setStatus(value)}
            placeholder="Add a note (optional)…"
            className="mt-[10px] w-full rounded-sm border border-line bg-white px-[11px] py-[8px] text-[14px] text-ink outline-none placeholder:text-[#b6a995] focus:border-accent"
          />
        </div>
      ))}

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
