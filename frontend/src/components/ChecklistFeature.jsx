import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import {
  addChecklistItem,
  archiveChecklist,
  deleteChecklistItem,
  notifyChecklist,
  toggleChecklistItem,
  updateChecklistItem,
} from "../api/client.js";
import { initialOf } from "../utils/avatar.js";
import { cx } from "../utils/classNames.js";
import { relativeTime } from "../utils/time.js";
import styles from "./styling/ChecklistFeature.module.css";

function ChecklistItemEditor({
  value,
  onChange,
  onSubmit,
  onCancel,
  onDelete,
  busy,
  placeholder,
}) {
  return (
    <form onSubmit={onSubmit} className={styles.itemEditor}>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={280}
        placeholder={placeholder}
        autoFocus
        className={cx("ui-textInput", styles.itemEditorInput)}
      />
      <button
        type="submit"
        disabled={busy || !value.trim()}
        className={cx("ui-pillButton ui-pillCheckSoft", styles.iconAction)}
        aria-label="Save checklist item"
        title="Save"
      >
        ✓
      </button>
      {onDelete || onCancel ? (
        <button
          type="button"
          disabled={busy}
          onClick={onDelete ?? onCancel}
          className={cx("ui-pillButton ui-pillDangerSoft", styles.iconAction)}
        >
          ×
        </button>
      ) : null}
    </form>
  );
}

export default function ChecklistFeature({
  checklists,
  onChecklistsChange,
  checklistFocusRequest,
  moduleTag,
}) {
  const { user } = useAuth();
  const checklistRefs = useRef(new Map());
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [addingChecklistId, setAddingChecklistId] = useState(null);
  const [newItemText, setNewItemText] = useState("");
  const [editingItem, setEditingItem] = useState(null);
  const [busyItemIds, setBusyItemIds] = useState([]);
  const [addingId, setAddingId] = useState(null);
  const [notifyingId, setNotifyingId] = useState(null);
  const [archivingId, setArchivingId] = useState(null);

  const cancelAdding = useCallback(() => {
    setAddingChecklistId(null);
    setNewItemText("");
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingItem(null);
  }, []);

  useEffect(() => {
    if (!checklistFocusRequest?.checklistId) return;
    const checklistExists = checklists.some(
      (checklist) => checklist.id === checklistFocusRequest.checklistId,
    );
    if (!checklistExists) return;
    setExpandedId(checklistFocusRequest.checklistId);
    cancelAdding();
    setEditingItem(null);
    window.requestAnimationFrame(() => {
      checklistRefs.current
        .get(checklistFocusRequest.checklistId)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [cancelAdding, checklistFocusRequest, checklists]);

  function toggleExpanded(id) {
    setExpandedId((current) => (current === id ? null : id));
    cancelAdding();
    setEditingItem(null);
  }

  function markItemBusy(itemId) {
    setBusyItemIds((current) => [...current, itemId]);
  }

  function clearItemBusy(itemId) {
    setBusyItemIds((current) => current.filter((id) => id !== itemId));
  }

  async function handleNotify(checklist) {
    if (notifyingId) return;
    setNotifyingId(checklist.id);
    setError("");
    try {
      await notifyChecklist(checklist.id, user.id);
    } catch (err) {
      setError(err.message || "Could not notify the shire. Try again.");
    } finally {
      setNotifyingId(null);
    }
  }

  async function handleAddItem(event, checklist) {
    event.preventDefault();
    const trimmed = newItemText.trim();
    if (!trimmed || addingId) return;
    setAddingId(checklist.id);
    setError("");
    try {
      onChecklistsChange(
        await addChecklistItem(checklist.id, user.id, trimmed),
      );
      cancelAdding();
    } catch (err) {
      setError(err.message || "Could not add the item. Try again.");
    } finally {
      setAddingId(null);
    }
  }

  async function handleToggleItem(checklist, item) {
    if (busyItemIds.includes(item.id)) return;
    markItemBusy(item.id);
    setError("");
    try {
      onChecklistsChange(
        await toggleChecklistItem(checklist.id, item.id, user.id),
      );
    } catch (err) {
      setError(err.message || "Could not update the item. Try again.");
    } finally {
      clearItemBusy(item.id);
    }
  }

  async function handleSaveItem(event, checklist) {
    event.preventDefault();
    const trimmed = editingItem?.text?.trim();
    if (!editingItem || !trimmed || busyItemIds.includes(editingItem.id))
      return;
    markItemBusy(editingItem.id);
    setError("");
    try {
      onChecklistsChange(
        await updateChecklistItem(
          checklist.id,
          editingItem.id,
          user.id,
          trimmed,
        ),
      );
      cancelEditing();
    } catch (err) {
      setError(err.message || "Could not edit the item. Try again.");
    } finally {
      clearItemBusy(editingItem.id);
    }
  }

  async function handleDeleteItem(checklist, item) {
    if (busyItemIds.includes(item.id)) return;
    markItemBusy(item.id);
    setError("");
    try {
      onChecklistsChange(
        await deleteChecklistItem(checklist.id, item.id, user.id),
      );
      setEditingItem((current) => (current?.id === item.id ? null : current));
    } catch (err) {
      setError(err.message || "Could not delete the item. Try again.");
    } finally {
      clearItemBusy(item.id);
    }
  }

  async function handleArchive(checklist) {
    if (archivingId) return;
    setArchivingId(checklist.id);
    setError("");
    try {
      onChecklistsChange(await archiveChecklist(checklist.id, user.id));
      setExpandedId((current) => (current === checklist.id ? null : current));
    } catch (err) {
      setError(err.message || "Could not archive the checklist. Try again.");
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <div className={styles.wrap}>
      {error && <p className={cx("ui-errorText", styles.error)}>{error}</p>}

      <div className={styles.list}>
        {checklists.length === 0 ? (
          <p className={styles.empty}>No checklists yet.</p>
        ) : (
          checklists.map((checklist) => {
            const expanded = expandedId === checklist.id;
            return (
              <div
                key={checklist.id}
                ref={(node) => {
                  if (node) {
                    checklistRefs.current.set(checklist.id, node);
                  } else {
                    checklistRefs.current.delete(checklist.id);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={() => toggleExpanded(checklist.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleExpanded(checklist.id);
                  }
                }}
                className={styles.card}
              >
                <div className={styles.summary}>
                  <div className={styles.summaryText}>
                    <div className={styles.titleRow}>
                      {moduleTag}
                      <p className={styles.title}>{checklist.title}</p>
                    </div>
                    <p className={styles.meta}>
                      {checklist.createdBy} ·{" "}
                      {relativeTime(checklist.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={notifyingId === checklist.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleNotify(checklist);
                    }}
                    className={styles.notifyButton}
                    aria-label="Notify all about checklist"
                    title="Notify all"
                  >
                    <img src="/bell.png" alt="" className={styles.notifyIcon} />
                  </button>
                </div>

                <div
                  className={cx(
                    styles.expandedRegion,
                    expanded ? styles.expanded : styles.collapsed,
                  )}
                >
                  <div
                    className={styles.expandedInner}
                    {...(!expanded ? { inert: "" } : {})}
                  >
                    <div
                      className={styles.panel}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <ul className={styles.items}>
                        {checklist.items.map((item) => {
                          const checkedByCount = (item.checkedByIds ?? [])
                            .length;
                          const checkedByUser = (
                            item.checkedByIds ?? []
                          ).includes(user.id);
                          const editing = editingItem?.id === item.id;
                          return (
                            <li
                              key={item.id}
                              className={cx(
                                styles.item,
                                checkedByCount > 0 ? styles.itemCovered : "",
                              )}
                            >
                              {editing ? (
                                <ChecklistItemEditor
                                  value={editingItem.text}
                                  onChange={(text) =>
                                    setEditingItem({
                                      ...editingItem,
                                      text,
                                    })
                                  }
                                  onSubmit={(event) =>
                                    handleSaveItem(event, checklist)
                                  }
                                  onCancel={cancelEditing}
                                  onDelete={() =>
                                    handleDeleteItem(checklist, item)
                                  }
                                  busy={busyItemIds.includes(item.id)}
                                  placeholder="Edit item"
                                />
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    disabled={busyItemIds.includes(item.id)}
                                    onClick={() =>
                                      handleToggleItem(checklist, item)
                                    }
                                    className={cx(
                                      styles.checkButton,
                                      checkedByUser ? styles.checkButtonOn : "",
                                    )}
                                    aria-label={
                                      checkedByUser
                                        ? "Uncheck checklist item"
                                        : "Check off checklist item"
                                    }
                                    title={
                                      checkedByUser ? "Uncheck" : "Check off"
                                    }
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingItem({
                                        id: item.id,
                                        text: item.text,
                                      })
                                    }
                                    className={styles.itemText}
                                  >
                                    {item.text}
                                  </button>
                                  <div className={styles.checkedIcons}>
                                    {(item.checkedBy ?? []).map((person) => (
                                      <span
                                        key={person.id}
                                        className={styles.checkedIcon}
                                        title={person.name}
                                      >
                                        {initialOf(person.name)}
                                      </span>
                                    ))}
                                  </div>
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>

                      {addingChecklistId === checklist.id ? (
                        <div className={styles.addEditor}>
                          <ChecklistItemEditor
                            value={newItemText}
                            onChange={setNewItemText}
                            onSubmit={(event) =>
                              handleAddItem(event, checklist)
                            }
                            onCancel={cancelAdding}
                            busy={addingId === checklist.id}
                            placeholder="Add an item"
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingItem(null);
                            setAddingChecklistId(checklist.id);
                          }}
                          className={cx(
                            "ui-pillButton ui-pillSecondary",
                            styles.addButton,
                          )}
                        >
                          Add item
                        </button>
                      )}

                      <div className={styles.actions}>
                        <button
                          type="button"
                          disabled={archivingId === checklist.id}
                          onClick={() => handleArchive(checklist)}
                          className={cx(
                            "ui-pillButton ui-pillSecondary",
                            styles.archiveButton,
                          )}
                        >
                          {archivingId === checklist.id
                            ? "Archiving…"
                            : "Archive"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
