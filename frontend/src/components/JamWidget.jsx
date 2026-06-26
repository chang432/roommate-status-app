import { useState } from 'react'
import {
  disconnectSpotify,
  endJam,
  getSpotifyAuthUrl,
  shareJam,
} from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import { cx } from '../utils/classNames.js'
import { relativeTime } from '../utils/time.js'
import styles from './styling/JamWidget.module.css'

function playbackText(jam) {
  if (!jam) return ''
  if (jam.playbackStatus === 'spotify_unconfigured') {
    return 'Spotify now playing is not configured yet.'
  }
  if (jam.playbackStatus === 'not_connected') {
    return `${jam.hostName} can connect Spotify to show host playback.`
  }
  if (jam.playbackStatus === 'not_playing') {
    return `${jam.hostName}'s Spotify is not playing right now.`
  }
  if (jam.playbackStatus === 'spotify_error') {
    return 'Could not refresh Spotify playback.'
  }
  if (!jam.nowPlaying) return 'Host playback unavailable.'
  return jam.nowPlaying.isPlaying ? 'Playing on host Spotify' : 'Paused on host Spotify'
}

export default function JamWidget({ jam, onJamChange }) {
  const { user } = useAuth()
  const [link, setLink] = useState('')
  const [saving, setSaving] = useState(false)
  const [ending, setEnding] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState('')
  const isHost = jam?.hostId === user.id

  async function handleSubmit(event) {
    event.preventDefault()
    const trimmed = link.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError('')
    try {
      onJamChange(await shareJam(trimmed, user.id))
      setLink('')
    } catch (err) {
      setError(err.message || 'Could not share that Jam link.')
    } finally {
      setSaving(false)
    }
  }

  async function handleEnd() {
    if (!jam || ending) return
    setEnding(true)
    setError('')
    try {
      onJamChange(await endJam(user.id))
    } catch (err) {
      setError(err.message || 'Could not end the Jam.')
    } finally {
      setEnding(false)
    }
  }

  async function handleConnectSpotify() {
    if (connecting) return
    setConnecting(true)
    setError('')
    try {
      const { url } = await getSpotifyAuthUrl(user.id)
      window.location.assign(url)
    } catch (err) {
      setError(err.message || 'Could not start Spotify connection.')
      setConnecting(false)
    }
  }

  async function handleDisconnectSpotify() {
    if (disconnecting) return
    setDisconnecting(true)
    setError('')
    try {
      await disconnectSpotify(user.id)
      if (jam) onJamChange({ ...jam, hostSpotifyConnected: false, nowPlaying: null, playbackStatus: 'not_connected' })
    } catch (err) {
      setError(err.message || 'Could not disconnect Spotify.')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <section className={styles.wrap} aria-label="Spotify Jam">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Spotify Jam</p>
          <h2 className={styles.title}>
            {jam ? `${jam.hostName}'s Jam is live` : 'Share a Jam link'}
          </h2>
        </div>
        {jam && (
          <a
            href={jam.link}
            target="_blank"
            rel="noreferrer"
            className={cx('ui-primaryButton', styles.joinButton)}
          >
            Join Jam
          </a>
        )}
      </div>

      {jam ? (
        <div className={styles.activeBody}>
          <div className={styles.playback}>
            {jam.nowPlaying?.albumImageUrl ? (
              <img
                src={jam.nowPlaying.albumImageUrl}
                alt=""
                className={styles.albumArt}
              />
            ) : (
              <div className={styles.albumFallback}>Jam</div>
            )}
            <div className={styles.playbackText}>
              <p className={styles.playbackStatus}>{playbackText(jam)}</p>
              {jam.nowPlaying ? (
                <>
                  <p className={styles.track}>{jam.nowPlaying.title}</p>
                  <p className={styles.artist}>
                    {jam.nowPlaying.artists?.join(', ') || 'Unknown artist'}
                  </p>
                </>
              ) : (
                <p className={styles.artist}>
                  Shared {relativeTime(jam.createdAt)}
                </p>
              )}
            </div>
          </div>

          <div className={styles.controls}>
            {isHost && !jam.hostSpotifyConnected && jam.spotifyConfigured && (
              <button
                type="button"
                onClick={handleConnectSpotify}
                disabled={connecting}
                className={cx('ui-pillButton ui-pillSecondary', styles.controlButton)}
              >
                {connecting ? 'Connecting...' : 'Show now playing'}
              </button>
            )}
            {isHost && jam.hostSpotifyConnected && (
              <button
                type="button"
                onClick={handleDisconnectSpotify}
                disabled={disconnecting}
                className={cx('ui-pillButton ui-pillSecondary', styles.controlButton)}
              >
                {disconnecting ? 'Disconnecting...' : 'Disconnect Spotify'}
              </button>
            )}
            {isHost && (
              <button
                type="button"
                onClick={handleEnd}
                disabled={ending}
                className={cx('ui-pillButton ui-pillDangerSoft', styles.controlButton)}
              >
                {ending ? 'Ending...' : 'End Jam'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="Paste a Spotify Jam link"
            className={cx('ui-textInput', styles.input)}
          />
          <button
            type="submit"
            disabled={saving || !link.trim()}
            className={cx('ui-primaryButton', styles.shareButton)}
          >
            {saving ? 'Sharing...' : 'Share Jam'}
          </button>
        </form>
      )}

      {jam && !isHost && jam.playbackStatus === 'not_connected' && (
        <p className={styles.note}>Only {jam.hostName} can enable now playing.</p>
      )}
      {error ? <p className={cx('ui-errorText', styles.error)}>{error}</p> : null}
    </section>
  )
}
