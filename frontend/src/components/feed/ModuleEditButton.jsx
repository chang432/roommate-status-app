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
      className={className}
      onClick={(event) => {
        event.stopPropagation();
        onEdit();
      }}
    >
      Edit
    </button>
  );
}
