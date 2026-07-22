import { cx } from '../../utils/classNames.js'
import styles from './Brandmark.module.css'

// The little roof motif used in the headers for a "household" feel.
export default function Brandmark({ className = '', iconClassName = '', inverted = false }) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        styles.brandmark,
        inverted ? styles.inverted : '',
        className || styles.defaultSize,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconClassName || styles.defaultIcon}
      >
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10.5V20h14v-9.5" />
        <path d="M10 20v-5h4v5" />
      </svg>
    </div>
  )
}
