import { STATUS, STATUS_DOT_CLASS } from '../utils/status.js'

// Statuses that render a tinted icon instead of a plain dot. Each value is a
// transparent-background PNG silhouette (served from public/); it's used as a
// CSS mask over the status color, so the icon "takes on" the dot's color.
const STATUS_ICON = {
  [STATUS.BUSY]: '/busy.png',
  [STATUS.OOH]: '/ooh.png',
  [STATUS.SLEEPING]: '/sleeping.png',
}

function maskStyle(src) {
  return {
    WebkitMaskImage: `url(${src})`,
    maskImage: `url(${src})`,
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
  }
}

// Status indicator shown to the left of a roommate. Statuses in STATUS_ICON
// render their icon tinted with the status color; the rest are a colored dot.
export default function StatusDot({ status, className = '' }) {
  const icon = STATUS_ICON[status]
  if (icon) {
    return (
      <span
        aria-hidden="true"
        style={maskStyle(icon)}
        className={`h-[16px] w-[16px] flex-none ${STATUS_DOT_CLASS[status]} ${className}`}
      />
    )
  }
  return (
    <span
      className={`h-[13px] w-[13px] flex-none rounded-full ${STATUS_DOT_CLASS[status] ?? 'bg-ink-soft'} ${className}`}
    />
  )
}
