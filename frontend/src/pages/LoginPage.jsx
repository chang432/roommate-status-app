import { useEffect, useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import Brandmark from '../components/Brandmark.jsx'
import RoomiePicker from '../components/RoomiePicker.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { getRoommates } from '../api/client.js'

export default function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()

  const [roommates, setRoommates] = useState([])
  const [selected, setSelected] = useState(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Populate the roommate picker from the API.
  useEffect(() => {
    let active = true
    getRoommates()
      .then((list) => {
        if (!active) return
        setRoommates(list)
        setSelected(list[0] ?? null)
      })
      .catch(() => setError('Could not load the household. Try again in a moment.'))
    return () => {
      active = false
    }
  }, [])

  // Already signed in? Skip the login screen.
  if (user) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    if (!selected) return
    setSubmitting(true)
    setError('')
    try {
      await login(selected.name, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // grid-cols-1 makes the single column minmax(0,1fr) rather than the implicit
    // `auto` track. An `auto` track grows to its content's intrinsic width, which
    // let RoomiePicker's intentionally-too-wide, horizontally-scrolling row
    // stretch the form past the viewport (page-level horizontal scrollbar).
    // minmax(0,1fr) caps the column at the available width so that row scrolls
    // internally — as intended — instead of widening the page.
    <main className="grid min-h-screen grid-cols-1 place-items-center px-5 py-8">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[420px] rounded-lg border border-line bg-card px-[34px] pb-[34px] pt-10 shadow-card"
      >
        <Brandmark className="mx-auto mb-[18px] h-[54px] w-[54px]" />

        <h1 className="mb-[6px] text-center font-display text-[28px] font-semibold leading-[1.15] -tracking-[0.01em]">
          York Terrace
          <br />
          Roomie Status
        </h1>
        <p className="mb-7 text-center text-[14.5px] text-ink-soft">
          Welcome home — pick your name to sign in.
        </p>

        <RoomiePicker
          roommates={roommates}
          selectedId={selected?.id}
          onSelect={setSelected}
        />

        <div className="mb-[26px]">
          <label
            htmlFor="password"
            className="mb-[10px] ml-[2px] block text-[12.5px] font-bold uppercase tracking-[0.04em] text-ink-soft"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="w-full rounded-sm border-[1.5px] border-line bg-white px-4 py-[14px] text-[15px] text-ink outline-none transition placeholder:text-[#b6a995] focus:border-accent focus:shadow-[0_0_0_4px_rgba(201,123,90,0.14)]"
          />
        </div>

        {error && (
          <p className="mb-4 rounded-sm bg-[#fbeae6] px-3 py-2 text-[13.5px] font-semibold text-status-red">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !selected}
          className="w-full rounded-sm bg-accent px-4 py-[15px] text-[15.5px] font-bold text-white shadow-soft transition hover:bg-accent-deep active:translate-y-px disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-[18px] text-center text-[12.5px] text-ink-soft">
          Just the six of us · 1024 York Terrace
        </p>
      </form>
    </main>
  )
}
