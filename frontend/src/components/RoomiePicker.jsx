import Avatar from './Avatar.jsx'
import { avatarColor } from '../utils/avatar.js'
import { cx } from '../utils/classNames.js'
import styles from './styling/RoomiePicker.module.css'

// Horizontal, swipeable list of roommates on the login screen. Tap a card to
// select who's signing in. Soft edge fades hint that the row scrolls.
export default function RoomiePicker({ roommates, selectedId, onSelect }) {
  return (
    <div className={styles.wrap}>
      <span className="ui-formLabel">
        Who&apos;s logging in?
      </span>

      <div className={styles.scroller}>
        {roommates.map((roommate, index) => {
          const selected = roommate.id === selectedId
          return (
            <button
              key={roommate.id}
              type="button"
              onClick={() => onSelect(roommate)}
              className={cx(
                styles.option,
                selected ? styles.selected : styles.unselected,
              )}
            >
              <Avatar
                name={roommate.name}
                color={avatarColor(index)}
                size={46}
                className={styles.avatar}
              />
              <span className={styles.name}>{roommate.name}</span>
            </button>
          )
        })}
      </div>

      {/* Edge fades to hint horizontal scrollability */}
      <div className={styles.fadeLeft} />
      <div className={styles.fadeRight} />
    </div>
  )
}
