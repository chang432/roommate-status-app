import { useEffect, useState } from 'react'
import {
  getCurrentGroup,
  removeGroupMember,
  setGroupMemberRole,
  updateGroupDisplay,
} from '../../api/client.js'
import { useTheme } from '../../context/ThemeContext.jsx'
import { THEME_DEFINITIONS, themeDefinition } from '../../models/themes.js'
import { cx } from '../../utils/classNames.js'
import { ROLE, ROLE_LABEL, isAdmin, isAdminIn, roleOf } from '../../utils/roles.js'
import styles from './ProfileSettings.module.css'

export default function ProfileSettings({
  user,
  roommates = [],
  onRoommatesChange,
  onGroupChange,
  onSignOut,
  onDeleteAccount,
}) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [error, setError] = useState('')
  const [group, setGroup] = useState(null)
  const [groupError, setGroupError] = useState('')
  const [copied, setCopied] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [pendingMemberId, setPendingMemberId] = useState('')
  const [displayError, setDisplayError] = useState('')
  const [updatingDisplay, setUpdatingDisplay] = useState(false)

  // Admin is per-group. Prefer the current-group response so profile controls
  // do not disappear while the independently loaded roster is refreshing.
  const viewerIsAdmin = group?.viewerIsAdmin ?? isAdminIn(roommates, user?.id)

  useEffect(() => {
    let cancelled = false
    if (!user?.hasGroup) {
      setGroup(null)
      setGroupError('')
      return () => {
        cancelled = true
      }
    }

    getCurrentGroup(user.id)
      .then(({ group: currentGroup }) => {
        if (cancelled) return
        setGroup(currentGroup)
        setGroupError('')
      })
      .catch((err) => {
        if (cancelled) return
        setGroup(null)
        setGroupError(err.message || 'Could not load group details.')
      })

    return () => {
      cancelled = true
    }
  }, [user?.hasGroup, user?.id])

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

  // Both admin actions return the updated roster, so the caller re-renders from
  // the server's view instead of guessing at the new membership locally.
  async function runMemberAction(memberId, action) {
    setMemberError('')
    setPendingMemberId(memberId)
    try {
      onRoommatesChange?.(await action())
    } catch (err) {
      setMemberError(err.message || 'Could not update that roommate.')
    } finally {
      setPendingMemberId('')
    }
  }

  function handleToggleAdmin(member) {
    const nextRole = isAdmin(member) ? ROLE.MEMBER : ROLE.ADMIN
    return runMemberAction(member.id, () =>
      setGroupMemberRole(user.id, member.id, nextRole),
    )
  }

  function handleRemoveMember(member) {
    if (!window.confirm(`Remove ${member.name} from this group?`)) return undefined
    return runMemberAction(member.id, () => removeGroupMember(user.id, member.id))
  }

  async function handleCopyCode() {
    if (!group?.joinCode) return
    await navigator.clipboard.writeText(group.joinCode)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  async function handleDisplayChange(field, checked) {
    if (!group || updatingDisplay) return
    setDisplayError('')
    setUpdatingDisplay(true)
    const nextSettings = {
      showRoster: group.showRoster !== false,
      showFeed: group.showFeed !== false,
      showBookClub: group.showBookClub !== false,
      [field]: checked,
    }
    try {
      const { group: updatedGroup } = await updateGroupDisplay(
        user.id,
        nextSettings.showRoster,
        nextSettings.showFeed,
        nextSettings.showBookClub,
      )
      setGroup(updatedGroup)
      onGroupChange?.(updatedGroup)
    } catch (err) {
      setDisplayError(err.message || 'Could not update group display settings.')
    } finally {
      setUpdatingDisplay(false)
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
          {/* Admin is per-group, so the badge tracks the group being viewed
              rather than the account — it disappears on switching to a group
              this user does not administer. */}
          {viewerIsAdmin && <p className={styles.adminBadge}>Group admin</p>}
        </div>
      </section>

      {user?.hasGroup && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3>Group</h3>
            <p>Share this code so new roommates can join your household.</p>
          </div>
          {groupError && <p className={cx('ui-errorBox', styles.error)}>{groupError}</p>}
          {group && (
            <div className={styles.groupCard}>
              <div>
                <p className={styles.groupName}>{group.name}</p>
                <p className={styles.groupCodeLabel}>Invite code</p>
              </div>
              <div className={styles.groupCodeRow}>
                <code className={styles.groupCode}>{group.joinCode}</code>
                <button type="button" onClick={handleCopyCode} className={styles.copyButton}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {viewerIsAdmin && group && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3>Group display</h3>
            <p>Choose which shared sections appear for everyone in this group.</p>
          </div>
          {displayError && <p className={cx('ui-errorBox', styles.error)}>{displayError}</p>}
          <div className={styles.displayControls}>
            <label className={styles.displayOption}>
              <span>
                <strong>Household roster</strong>
                <small>Show roommate statuses and household actions.</small>
              </span>
              <input
                type="checkbox"
                checked={group.showRoster !== false}
                disabled={updatingDisplay}
                onChange={(event) => handleDisplayChange('showRoster', event.target.checked)}
              />
            </label>
            <label className={styles.displayOption}>
              <span>
                <strong>Group feed</strong>
                <small>Show events, requests, checklists, and TV shows.</small>
              </span>
              <input
                type="checkbox"
                checked={group.showFeed !== false}
                disabled={updatingDisplay}
                onChange={(event) => handleDisplayChange('showFeed', event.target.checked)}
              />
            </label>
            <label className={styles.displayOption}>
              <span>
                <strong>Book Club</strong>
                <small>Show the group Book Club section.</small>
              </span>
              <input
                type="checkbox"
                checked={group.showBookClub !== false}
                disabled={updatingDisplay}
                onChange={(event) => handleDisplayChange('showBookClub', event.target.checked)}
              />
            </label>
          </div>
        </section>
      )}

      {user?.hasGroup && roommates.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3>Members</h3>
            <p>
              {viewerIsAdmin
                ? 'Admins can remove roommates and grant admin.'
                : 'Only admins can remove roommates or change roles.'}
            </p>
          </div>
          {memberError && <p className={cx('ui-errorBox', styles.error)}>{memberError}</p>}
          <ul className={styles.memberList}>
            {roommates.map((member) => {
              const isSelf = member.id === user.id
              const busy = pendingMemberId === member.id
              return (
                <li key={member.id} className={styles.memberRow}>
                  <div className={styles.memberIdentity}>
                    <span className={styles.memberName}>
                      {member.name}
                      {isSelf ? ' (you)' : ''}
                    </span>
                    <span className={styles.memberRole}>{ROLE_LABEL[roleOf(member)]}</span>
                  </div>
                  {viewerIsAdmin && (
                    <div className={styles.memberActions}>
                      <button
                        type="button"
                        onClick={() => handleToggleAdmin(member)}
                        disabled={busy}
                        className={styles.memberButton}
                      >
                        {isAdmin(member) ? 'Revoke admin' : 'Make admin'}
                      </button>
                      {/* Admins are peers: demote one before removing them, which
                          also stops a group from losing its last admin. */}
                      {!isSelf && !isAdmin(member) && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(member)}
                          disabled={busy}
                          className={cx(styles.memberButton, styles.memberRemove)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Appearance</h3>
          <p>Current theme: {themeDefinition(resolvedTheme)?.label ?? resolvedTheme}</p>
        </div>
        <div className={styles.themeChoices} role="radiogroup" aria-label="Theme">
          {THEME_DEFINITIONS.map((choice) => (
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
