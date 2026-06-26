import { useEffect, useState } from "react";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import Brandmark from "../components/Brandmark.jsx";
import RoomiePicker from "../components/RoomiePicker.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { getRoommates } from "../api/client.js";
import { cx } from "../utils/classNames.js";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = location.state?.returnTo || "/";

  const [roommates, setRoommates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Populate the roommate picker from the API.
  useEffect(() => {
    let active = true;
    getRoommates()
      .then((list) => {
        if (!active) return;
        setRoommates(list);
        setSelected(list[0] ?? null);
      })
      .catch(() =>
        setError("Could not load the shire. Try again in a moment."),
      );
    return () => {
      active = false;
    };
  }, []);

  // Already signed in? Skip the login screen.
  if (user) return <Navigate to={returnTo} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setError("");
    try {
      await login(selected.name, password);
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // grid-cols-1 makes the single column minmax(0,1fr) rather than the implicit
    // `auto` track. An `auto` track grows to its content's intrinsic width, which
    // let RoomiePicker's intentionally-too-wide, horizontally-scrolling row
    // stretch the form past the viewport (page-level horizontal scrollbar).
    // minmax(0,1fr) caps the column at the available width so that row scrolls
    // internally — as intended — instead of widening the page.
    <main className={styles.page}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <Brandmark className={styles.brandmark} />

        <h1 className={styles.title}>
          Yorkshire
          <br />
          Roomie Status
        </h1>
        <p className={styles.subtitle}>
          Welcome home — pick your name to sign in.
        </p>

        <RoomiePicker
          roommates={roommates}
          selectedId={selected?.id}
          onSelect={setSelected}
        />

        <div className={styles.passwordField}>
          <label htmlFor="password" className="ui-formLabel">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className={cx("ui-textInput", styles.passwordInput)}
          />
        </div>

        {error && <p className={cx("ui-errorBox", styles.error)}>{error}</p>}

        <button
          type="submit"
          disabled={submitting || !selected}
          className={cx("ui-primaryButton", styles.submit)}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>

        <p className={styles.footer}>Just the six of us · 1024 Yorkshire</p>
      </form>
    </main>
  );
}
