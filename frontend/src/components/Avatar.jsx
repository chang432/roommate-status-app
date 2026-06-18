import { initialOf } from '../utils/avatar.js'
import { cx } from '../utils/classNames.js'
import styles from './Avatar.module.css'

// Round, colored initial badge for a roommate. `color` is a CSS color string
// (see utils/avatar.js); `size` controls the diameter and font.
export default function Avatar({ name, color, size = 46, className = '' }) {
  return (
    <span
      className={cx(styles.avatar, className)}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        fontSize: Math.round(size * 0.41),
      }}
    >
      {initialOf(name)}
    </span>
  )
}
