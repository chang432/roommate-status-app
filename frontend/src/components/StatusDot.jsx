import { STATUS, STATUS_DOT_CLASS } from '../utils/status.js'

// Mask the busy icon (a transparent-background PNG silhouette) so it renders
// filled with the busy status color instead of plain white — i.e. the dot's
// color is "painted" onto the image shape.
const BUSY_MASK_STYLE = {
  WebkitMaskImage: 'url(/busy.png)',
  maskImage: 'url(/busy.png)',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
}

// Status indicator shown to the left of a roommate. For "busy" this is the busy
// icon tinted with the busy color; every other status is a small colored dot.
export default function StatusDot({ status, className = '' }) {
  if (status === STATUS.BUSY) {
    return (
      <span
        aria-hidden="true"
        style={BUSY_MASK_STYLE}
        className={`h-[16px] w-[16px] flex-none ${STATUS_DOT_CLASS[STATUS.BUSY]} ${className}`}
      />
    )
  }
  return (
    <span
      className={`h-[13px] w-[13px] flex-none rounded-full ${STATUS_DOT_CLASS[status] ?? 'bg-ink-soft'} ${className}`}
    />
  )
}
