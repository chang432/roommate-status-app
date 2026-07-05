import { useState } from 'react'
import { useTheme } from '../context/ThemeContext.jsx'
import { cx } from '../utils/classNames.js'
import styles from './styling/ProfileSettings.module.css'

const THEME_CHOICES = [
  { id: 'system', label: 'System', description: 'Match this device' },
  { id: 'light', label: 'Light', description: 'Warm daylight' },
  { id: 'dark', label: 'Dark', description: 'Low-light room' },
]

export default function ProfileSettings({
  user,
  onSignOut,
  onDeleteAccount,
}) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [error, setError] = useState('')

  async function handleDeleteAccount() {
    const password = window.prompt('Enter your password to delete this account.')
    if (!password) return
    if (!window.confirm('Delete this account? This cannot be undone.')) return
    try {
      setError('')
      await onDeleteAccount(password)
    } catch (err) {
      setError(err.message || 'Could not delete this account.')
    }
  }

  return (
    <div className={styles.panel}>
      <section className={styles.identityCard}>
        <div className={styles.avatar} aria-hidden="true">
          {(user?.name || user?.username || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className={styles.identityText}>
          <p className={styles.name}>{user?.name || 'Roomie'}</p>
          <p className={styles.username}>@{user?.username || user?.id}</p>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Appearance</h3>
          <p>Current theme: {resolvedTheme}</p>
        </div>
        <div className={styles.themeChoices} role="radiogroup" aria-label="Theme">
          {THEME_CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={theme === choice.id}
              onClick={() => setTheme(choice.id)}
              className={cx(
                styles.themeChoice,
                theme === choice.id && styles.themeChoiceActive,
              )}
            >
              <span className={styles.choiceLabel}>{choice.label}</span>
              <span className={styles.choiceDescription}>{choice.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Session</h3>
          <p>Manage this device’s signed-in state.</p>
        </div>
        <button type="button" onClick={onSignOut} className={styles.signOutButton}>
          Sign out
        </button>
      </section>

      <section className={styles.dangerSection}>
        <div className={styles.sectionHeader}>
          <h3>Danger zone</h3>
          <p>Deleting your account removes your sign-in and notification subscriptions.</p>
        </div>
        {error && <p className={cx('ui-errorBox', styles.error)}>{error}</p>}
        <button
          type="button"
          onClick={handleDeleteAccount}
          className={styles.deleteButton}
        >
          Delete account
        </button>
      </section>
    </div>
  )
}
