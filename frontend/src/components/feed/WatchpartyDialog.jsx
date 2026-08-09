import ModalShell from "../ui/ModalShell.jsx";
import styles from "./ShowTrackerFeature.module.css";

export default function WatchpartyDialog({
  busy,
  draft,
  onChange,
  onClose,
  onSubmit,
  show,
}) {
  if (!show) return null;

  return (
    <ModalShell
      title="Start Watchparty"
      ariaLabel={`Start ${show.title} watchparty`}
      onClose={onClose}
      widthClassName={styles.watchpartyDialog}
    >
      <form className={styles.watchpartyForm} onSubmit={onSubmit}>
        <p className={styles.watchpartyTitle}>{show.title}</p>
        <div className={styles.watchpartyFields}>
          {["season", "episode"].map((field) => (
            <label key={field} className={styles.watchpartyField}>
              <span>{field === "season" ? "Season" : "Episode"}</span>
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={draft[field]}
                onChange={(event) => onChange(field, event.target.value)}
              />
            </label>
          ))}
        </div>
        <div className="ui-formActions">
          <button
            type="button"
            onClick={onClose}
            className="ui-secondaryButton ui-formActionButton"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="ui-primaryButton ui-formActionButton"
          >
            {busy ? "Starting…" : "Start"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

