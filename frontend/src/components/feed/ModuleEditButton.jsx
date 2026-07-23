import { cx } from "../../utils/classNames.js";

export default function ModuleEditButton({
  onEdit,
  disabled = false,
  className,
}) {
  if (!onEdit) return null;

  return (
    <button
      type="button"
      disabled={disabled}
      className={cx(
        "ui-pillButton ui-pillSecondary ui-moduleActionButton",
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        onEdit();
      }}
    >
      Edit
    </button>
  );
}
