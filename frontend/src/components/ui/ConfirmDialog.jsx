import { useEffect, useRef } from "react";
import ModalShell from "./ModalShell.jsx";
import styles from "./ConfirmDialog.module.css";

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  onCancel,
  onConfirm,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <ModalShell title={title} onClose={onCancel} widthClassName={styles.dialog}>
      <p className={styles.message}>{message}</p>
      <div className={styles.actions}>
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className={`ui-pillButton ui-pillSecondary ${styles.action}`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`ui-pillButton ui-pillDanger ${styles.action}`}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
