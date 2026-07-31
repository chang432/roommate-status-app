import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx } from "../../utils/classNames.js";
import { sanitizeAllTypes } from "./modulePreferences.js";
import styles from "./GroupFeed.module.css";

export default function ModuleNav({
  activeType,
  counts,
  moduleTypes,
  drawerOpen,
  onClose,
  onSelect,
  editMode,
  onEditModeChange,
  allTypes,
  onAllTypesChange,
  onReorderType,
}) {
  const navRef = useRef(null);
  const dragPointerRef = useRef(null);
  const dragTypeRef = useRef(null);
  const lastDropTypeRef = useRef(null);
  const editRowRefs = useRef(new Map());
  const rowPositionsBeforeReorderRef = useRef(null);
  const [allDropdownOpen, setAllDropdownOpen] = useState(false);
  const [draggingType, setDraggingType] = useState(null);
  const editableTypes = moduleTypes.filter((type) => type.id !== "all");
  const selectedAllLabels = editableTypes
    .filter((type) => allTypes.includes(type.id))
    .map((type) => type.shortLabel || type.label);

  function handleAllTypeToggle(typeId, checked) {
    const next = checked
      ? [...allTypes, typeId]
      : allTypes.filter((id) => id !== typeId);
    onAllTypesChange(
      sanitizeAllTypes(
        next,
        editableTypes.map((type) => type.id),
      ),
    );
  }

  function reorderType(draggedType, targetType) {
    if (
      !draggedType ||
      !targetType ||
      draggedType === targetType ||
      lastDropTypeRef.current === targetType
    ) {
      return;
    }

    // Capture each row before the order updates. The layout effect below
    // animates it from this position into its new spot (a FLIP animation).
    rowPositionsBeforeReorderRef.current = new Map(
      [...editRowRefs.current].map(([typeId, row]) => [
        typeId,
        row.getBoundingClientRect().top,
      ]),
    );
    lastDropTypeRef.current = targetType;
    onReorderType(draggedType, targetType);
  }

  useLayoutEffect(() => {
    const previousPositions = rowPositionsBeforeReorderRef.current;
    rowPositionsBeforeReorderRef.current = null;
    if (!previousPositions) return;

    previousPositions.forEach((previousTop, typeId) => {
      const row = editRowRefs.current.get(typeId);
      if (!row) return;
      const distance = previousTop - row.getBoundingClientRect().top;
      if (!distance) return;
      row.animate?.(
        [
          { transform: `translateY(${distance}px)` },
          { transform: "translateY(0)" },
        ],
        { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    });
  }, [moduleTypes]);

  const finishEditing = useCallback(() => {
    onEditModeChange(false);
    setAllDropdownOpen(false);
    setDraggingType(null);
    dragPointerRef.current = null;
    dragTypeRef.current = null;
    lastDropTypeRef.current = null;
  }, [onEditModeChange]);

  function finishTouchDrag(event) {
    const drag = dragPointerRef.current;
    dragPointerRef.current = null;
    if (!drag || event.pointerId !== drag.pointerId) {
      setDraggingType(null);
      dragTypeRef.current = null;
      lastDropTypeRef.current = null;
      return;
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const dropTarget = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest("[data-module-drop-type], [data-module-type]");
    const dropType =
      dropTarget?.getAttribute("data-module-drop-type") ||
      dropTarget?.getAttribute("data-module-type");
    reorderType(drag.type, dropType);
    setDraggingType(null);
    dragTypeRef.current = null;
    lastDropTypeRef.current = null;
  }

  function previewTouchDrag(event) {
    const drag = dragPointerRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dropType = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest("[data-module-drop-type]")
      ?.getAttribute("data-module-drop-type");
    reorderType(drag.type, dropType);
  }

  useEffect(() => {
    if (!editMode) return undefined;
    function handlePointerDown(event) {
      if (navRef.current?.contains(event.target)) return;
      finishEditing();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [editMode, finishEditing]);

  useEffect(() => {
    if (drawerOpen) return;
    finishEditing();
  }, [drawerOpen, finishEditing]);

  return (
    <>
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close module list"
          className={styles.drawerBackdrop}
          onClick={() => {
            finishEditing();
            onClose();
          }}
        />
      ) : null}
      <aside
        id="group-feed-menu"
        ref={navRef}
        className={cx(styles.moduleNav, drawerOpen ? styles.moduleNavOpen : "")}
        aria-label="Module types"
        aria-hidden={!drawerOpen}
        inert={drawerOpen ? undefined : ""}
      >
        <div className={styles.moduleNavHeader}>
          <p className={styles.moduleNavEyebrow}>Modules</p>
          <div className={styles.moduleNavHeaderActions}>
            <button
              type="button"
              className={styles.moduleNavEdit}
              onClick={() => {
                if (editMode) finishEditing();
                else onEditModeChange(true);
              }}
            >
              {editMode ? "Done" : "Edit"}
            </button>
            <button
              type="button"
              className={styles.moduleNavClose}
              onClick={() => {
                finishEditing();
                onClose();
              }}
            >
              Close
            </button>
          </div>
        </div>
        <div className={styles.moduleNavList}>
          {moduleTypes.map((type) => {
            const filterContent = (
              <>
                <span>{type.label}</span>
                <span className={styles.moduleNavCount}>
                  {counts[type.id] ?? 0}
                </span>
              </>
            );
            const filterButton = editMode ? (
              <div
                key={type.id}
                data-module-type={type.id === "all" ? undefined : type.id}
                className={cx(
                  styles.moduleNavItem,
                  styles.moduleNavItemEditing,
                  type.id === "all" ? "" : styles.modulePalette,
                  activeType === type.id ? styles.moduleNavItemActive : "",
                )}
              >
                {filterContent}
              </div>
            ) : (
              <button
                key={type.id}
                type="button"
                onClick={() => onSelect(type.id)}
                data-module-type={type.id === "all" ? undefined : type.id}
                className={cx(
                  styles.moduleNavItem,
                  type.id === "all" ? "" : styles.modulePalette,
                  activeType === type.id ? styles.moduleNavItemActive : "",
                )}
              >
                {filterContent}
              </button>
            );
            if (!editMode) return filterButton;
            if (type.id === "all") {
              return (
                <div key={type.id} className={styles.moduleNavAllEditor}>
                  <button
                    type="button"
                    className={cx(
                      styles.moduleNavItem,
                      styles.moduleNavAllDropdown,
                      activeType === type.id ? styles.moduleNavItemActive : "",
                    )}
                    onClick={() => setAllDropdownOpen((current) => !current)}
                    aria-expanded={allDropdownOpen}
                  >
                    <span>{type.label}</span>
                    <span className={styles.moduleNavAllSummary}>
                      {selectedAllLabels.length === editableTypes.length
                        ? "All selected"
                        : `${selectedAllLabels.length} selected`}
                      <span aria-hidden="true">
                        {allDropdownOpen ? "▴" : "▾"}
                      </span>
                    </span>
                  </button>
                  {allDropdownOpen ? (
                    <div className={styles.moduleNavAllMenu}>
                      {editableTypes.map((option) => (
                        <label
                          key={option.id}
                          className={styles.moduleNavAllOption}
                        >
                          <input
                            type="checkbox"
                            checked={allTypes.includes(option.id)}
                            onChange={(event) =>
                              handleAllTypeToggle(
                                option.id,
                                event.target.checked,
                              )
                            }
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            }
            return (
              <div
                key={type.id}
                ref={(element) => {
                  if (element) editRowRefs.current.set(type.id, element);
                  else editRowRefs.current.delete(type.id);
                }}
                data-module-drop-type={type.id}
                className={cx(
                  styles.moduleNavEditRow,
                  draggingType === type.id
                    ? styles.moduleNavEditRowDragging
                    : "",
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  reorderType(dragTypeRef.current, type.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedId = event.dataTransfer.getData("text/plain");
                  reorderType(draggedId, type.id);
                  setDraggingType(null);
                  dragTypeRef.current = null;
                  lastDropTypeRef.current = null;
                }}
              >
                {filterButton}
                <button
                  type="button"
                  draggable
                  className={styles.moduleNavDragHandle}
                  aria-label={`Drag ${type.label} to reorder`}
                  onPointerDown={(event) => {
                    if (event.pointerType === "mouse") return;
                    event.preventDefault();
                    dragPointerRef.current = {
                      pointerId: event.pointerId,
                      type: type.id,
                    };
                    dragTypeRef.current = type.id;
                    lastDropTypeRef.current = null;
                    setDraggingType(type.id);
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                  }}
                  onPointerMove={previewTouchDrag}
                  onPointerUp={finishTouchDrag}
                  onPointerCancel={(event) => {
                    if (dragPointerRef.current?.pointerId === event.pointerId) {
                      dragPointerRef.current = null;
                      dragTypeRef.current = null;
                      lastDropTypeRef.current = null;
                      setDraggingType(null);
                      event.currentTarget.releasePointerCapture?.(
                        event.pointerId,
                      );
                    }
                  }}
                  onDragStart={(event) => {
                    dragTypeRef.current = type.id;
                    lastDropTypeRef.current = null;
                    setDraggingType(type.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", type.id);
                  }}
                  onDragEnd={() => {
                    dragTypeRef.current = null;
                    lastDropTypeRef.current = null;
                    setDraggingType(null);
                  }}
                >
                  ☰
                </button>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
