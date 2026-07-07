import { STATUS } from '../utils/status.js'
import { cx } from '../utils/classNames.js'
import styles from './styling/StatusDot.module.css'

// Statuses that render a tinted icon instead of a plain dot. Each value is a
// transparent-background PNG silhouette (served from public/); it's used as a
// CSS mask over the status color, so the icon "takes on" the dot's color.
const STATUS_ICON = {
  [STATUS.AVAILABLE]: '/available.png',
  [STATUS.BUSY]: '/busy.png',
  [STATUS.OOH]: '/ooh.png',
  [STATUS.SLEEPING]: '/sleeping.png',
}

const STATUS_CLASS = {
  [STATUS.AVAILABLE]: styles.available,
  [STATUS.BUSY]: styles.busy,
  [STATUS.SLEEPING]: styles.sleeping,
  [STATUS.OOH]: styles.ooh,
  [STATUS.ACTIVITY_LIVE]: styles.activityLive,
  [STATUS.ACTIVITY_ENDED]: styles.activityEnded,
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
        className={cx(styles.icon, STATUS_CLASS[status], className)}
      />
    )
  }
  return (
    <span
      className={cx(styles.dot, STATUS_CLASS[status] ?? styles.unknown, className)}
    />
  )
}
