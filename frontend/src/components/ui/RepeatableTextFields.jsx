import { cx } from "../../utils/classNames.js";
import styles from "./RepeatableTextFields.module.css";

export default function RepeatableTextFields({
  label,
  itemLabel,
  values,
  onChange,
  addLabel,
  placeholder,
  disabled = false,
  maxItems,
}) {
  const atLimit = maxItems !== undefined && values.length >= maxItems;

  function updateValue(index, value) {
    onChange(
      values.map((currentValue, valueIndex) =>
        valueIndex === index ? value : currentValue,
      ),
    );
  }

  function removeValue(index) {
    // Keep one draft row mounted so an emptied list remains immediately usable.
    onChange(
      values.length === 1
        ? [""]
        : values.filter((_, valueIndex) => valueIndex !== index),
    );
  }

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.items}>
        {values.map((value, index) => (
          <div className={styles.itemRow} key={index}>
            <input
              type="text"
              className={cx("ui-textInput", styles.input)}
              value={value}
              onChange={(event) => updateValue(index, event.target.value)}
              maxLength={280}
              placeholder={placeholder}
              disabled={disabled}
              aria-label={`${itemLabel} ${index + 1}`}
            />
            <button
              type="button"
              className={styles.removeItem}
              onClick={() => removeValue(index)}
              disabled={disabled}
              aria-label={`Remove ${itemLabel.toLowerCase()} ${index + 1}`}
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className={cx("ui-pillButton ui-pillSecondary", styles.addItem)}
        onClick={() => onChange([...values, ""])}
        disabled={disabled || atLimit}
      >
        {addLabel}
      </button>
    </div>
  );
}
