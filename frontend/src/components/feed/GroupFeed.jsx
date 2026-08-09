import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ModuleFeedItem, { ModuleTag } from "./ModuleFeedItem.jsx";
import ModuleNav from "./ModuleNav.jsx";
import ModuleTabs from "./ModuleTabs.jsx";
import useFeedNavigation from "./useFeedNavigation.js";
import useFeedFocus from "./useFeedFocus.js";
import useFeedPreferences from "./useFeedPreferences.js";
import ModalShell from "../ui/ModalShell.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { endActivity, startActivity } from "../../api/activities.js";
import useGroupModules from "../../hooks/useGroupModules.js";
import {
  FEED_MODULE_REGISTRY,
  canCreateFeedModule,
  canEditFeedModule,
  renderFeedModuleEdit,
} from "./feedModuleRegistry.jsx";
import { getModuleCounts, modulesForCategory } from "./moduleSelectors.js";
import { cx } from "../../utils/classNames.js";
import { isAdminIn } from "../../utils/roles.js";
import styles from "./GroupFeed.module.css";

export default function GroupFeed({ onLoadStateChange, ...props }) {
  const { user } = useAuth();
  const moduleState = useGroupModules(
    user.id,
    user.activeGroupId,
    props.enabledModuleIds ?? "all",
  );

  useEffect(() => {
    onLoadStateChange?.(user.activeGroupId, moduleState.loading);
  }, [moduleState.loading, onLoadStateChange, user.activeGroupId]);

  return <GroupFeedView {...props} {...moduleState} />;
}

export function GroupFeedView({
  roommates,
  modules,
  loading,
  error: feedError,
  refreshModules,
  enabledModuleIds = [],
}) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moduleNavEditing, setModuleNavEditing] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const [transitioningId, setTransitioningId] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState(null);
  const [editingModule, setEditingModule] = useState(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const canAdministerBookClub = isAdminIn(roommates, user.id);
  const {
    activeType,
    allTypes,
    enabledTypeIds,
    moduleTypes,
    reloadPreferences,
    reorderModuleType,
    setActiveType,
    setAllTypes,
  } = useFeedPreferences(user, enabledModuleIds);

  const feedModules = useMemo(
    () =>
      modules.filter(
        (module) =>
          module.type !== "spotify" && enabledTypeIds.has(module.type),
      ),
    [enabledTypeIds, modules],
  );
  const moduleCounts = useMemo(
    () => getModuleCounts(feedModules, allTypes),
    [allTypes, feedModules],
  );

  const restorableTypeIds = useMemo(() => {
    const result = new Set();
    moduleTypes.forEach(({ id }) => {
      const typeModules = modulesForCategory(feedModules, allTypes, id);
      if (
        typeModules.some((module) => !module.isArchived) ||
        (archivedOpen && typeModules.some((module) => module.isArchived))
      ) {
        result.add(id);
      }
    });
    return result;
  }, [allTypes, archivedOpen, feedModules, moduleTypes]);

  const {
    convertingDeferredOffset,
    deferredCategoryOffset,
    feedShellRef,
    feedSwipeOffset,
    feedSwipePhase,
    feedSwipeScrollSnapshot,
    feedSwipeTravelDistance,
    handleFeedClickCapture,
    handleFeedPanelTransitionEnd,
    handleFeedPointerCancel,
    handleFeedPointerDown,
    handleFeedPointerMove,
    handleFeedPointerUp,
    panelHorizontalOffset,
    panelVerticalOffset,
    resetCategoryPositions,
    selectModuleType: navigateToModuleType,
    stickyHeaderRef,
    visiblePanelTypes,
  } = useFeedNavigation({
    activeType,
    loading,
    moduleTypes,
    restorableTypeIds,
    setActiveType,
    setNavigationError,
  });

  useEffect(() => {
    reloadPreferences();
    resetCategoryPositions();
  }, [reloadPreferences, resetCategoryPositions, user.activeGroupId, user.id]);

  const { consumeFocusIntent, focusIntent } = useFeedFocus({
    feedError,
    loading,
    moduleTypes,
    modules,
    mutationError,
    searchParams,
    setActiveType,
    setArchivedOpen,
    setNavigationError,
    setSearchParams,
  });

  useEffect(() => {
    if (!drawerOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  // Every mutation surfaces through the unified feed, so each change handler
  // just refreshes it.
  const handleActivitiesChange = useCallback(
    () => refreshModules(),
    [refreshModules],
  );
  const handleShowsChange = useCallback(() => {
    window.dispatchEvent(new Event("roomie:shows-changed"));
    refreshModules();
  }, [refreshModules]);

  function moduleChangeHandler(type) {
    return type === "tv" ? handleShowsChange : handleActivitiesChange;
  }

  async function handleLiveTransition(activity, action) {
    if (transitioningId) return;
    setTransitioningId(activity.id);
    setMutationError("");
    try {
      const transition = action === "start" ? startActivity : endActivity;
      await transition(activity.id, user.id);
      refreshModules();
    } catch (err) {
      setMutationError(
        err.message || `Could not ${action} the event. Try again.`,
      );
    } finally {
      setTransitioningId(null);
    }
  }

  function selectModuleType(type) {
    navigateToModuleType(type);
    setDrawerOpen(false);
  }

  function openCreateModal() {
    const definition = FEED_MODULE_REGISTRY[activeType];
    if (
      definition &&
      !canCreateFeedModule(definition, { canAdministerBookClub })
    ) {
      return;
    }
    setCreateType(activeType === "all" ? null : activeType);
    setCreateModalOpen(true);
  }

  function renderCreateContent() {
    if (!createType) {
      return (
        <div className={styles.createPicker}>
          {moduleTypes
            .filter((type) => type.id !== "all")
            .filter((type) =>
              canCreateFeedModule(FEED_MODULE_REGISTRY[type.id], {
                canAdministerBookClub,
              }),
            )
            .map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => setCreateType(type.id)}
                className={cx(styles.modulePalette, styles.createPickerButton)}
                data-module-type={type.id}
              >
                {FEED_MODULE_REGISTRY[type.id].createLabel}
              </button>
            ))}
        </div>
      );
    }

    const definition = FEED_MODULE_REGISTRY[createType];
    return definition.renderCreate({
      roommates,
      onChanged: moduleChangeHandler(createType),
      onClose: () => setCreateModalOpen(false),
    });
  }

  function renderModule(module, onEdit) {
    const definition = FEED_MODULE_REGISTRY[module.type];
    if (!definition) return null;
    const moduleTag = <ModuleTag module={module} />;
    return definition.renderCard({
      module,
      moduleTag,
      onChanged: moduleChangeHandler(module.type),
      onEdit,
      onLiveTransition: handleLiveTransition,
      roommates,
      transitioningId,
      canAdministerBookClub,
    });
  }

  function renderFeedPanel(type, isActivePanel) {
    const visibleModules = modulesForCategory(feedModules, allTypes, type);
    const activeModules = visibleModules.filter((module) => !module.isArchived);
    const archivedModules = visibleModules.filter(
      (module) => module.isArchived,
    );
    const panelFocusIntent = isActivePanel ? focusIntent : null;

    return (
      <>
        <div className={styles.feedList}>
          {activeModules.length === 0 ? (
            <p className={styles.emptyFeed}>No active modules here yet.</p>
          ) : (
            activeModules.map((module) => (
              <ModuleFeedItem
                key={`${module.type}:${module.id}`}
                module={module}
                focusIntent={panelFocusIntent}
                onFocusHandled={consumeFocusIntent}
                canEdit={canEditFeedModule(
                  FEED_MODULE_REGISTRY[module.type],
                  module,
                  user.id,
                )}
                onEdit={() => setEditingModule(module)}
              >
                {(onEdit) => renderModule(module, onEdit)}
              </ModuleFeedItem>
            ))
          )}
        </div>

        {archivedModules.length > 0 && (
          <div className={styles.feedArchiveSection}>
            <button
              type="button"
              onClick={() => setArchivedOpen((current) => !current)}
              className={styles.feedArchiveToggle}
              aria-expanded={archivedOpen}
            >
              <span>Archived ({archivedModules.length})</span>
              <span aria-hidden="true">{archivedOpen ? "▴" : "▾"}</span>
            </button>
            {archivedOpen && (
              <div className={styles.feedList}>
                {archivedModules.map((module) => (
                  <ModuleFeedItem
                    key={`${module.type}:${module.id}`}
                    module={module}
                    focusIntent={panelFocusIntent}
                    onFocusHandled={consumeFocusIntent}
                    canEdit={canEditFeedModule(
                      FEED_MODULE_REGISTRY[module.type],
                      module,
                      user.id,
                    )}
                    onEdit={() => setEditingModule(module)}
                  >
                    {(onEdit) => renderModule(module, onEdit)}
                  </ModuleFeedItem>
                ))}
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  const createTitle = createType
    ? FEED_MODULE_REGISTRY[createType].createLabel
    : "Create a module";
  const createLabel =
    activeType === "all"
      ? "Create a module"
      : FEED_MODULE_REGISTRY[activeType].createLabel;
  const canCreateModule = enabledTypeIds.size > 0;

  if (loading) {
    return <p className={styles.loading}>Loading the feed…</p>;
  }

  return (
    <section className={styles.feedSection}>
      {(feedError || mutationError) && (
        <p className={cx("ui-errorBox", styles.pageError)}>
          {feedError || mutationError}
        </p>
      )}
      {navigationError && (
        <p className={cx("ui-errorBox", styles.pageError)}>{navigationError}</p>
      )}

      <div ref={feedShellRef} className={styles.shell} data-feed-shell>
        <ModuleNav
          activeType={activeType}
          counts={moduleCounts}
          moduleTypes={moduleTypes}
          drawerOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onSelect={selectModuleType}
          editMode={moduleNavEditing}
          onEditModeChange={setModuleNavEditing}
          allTypes={allTypes}
          onAllTypesChange={setAllTypes}
          onReorderType={reorderModuleType}
        />

        <div
          ref={stickyHeaderRef}
          className={styles.feedStickyHeader}
          data-feed-sticky-header
        >
          <div className={styles.feedHeader} data-feed-title-row>
            <h2 className={styles.feedTitle}>Group Feed</h2>
            <div className={styles.createInlineSlot} data-feed-create-slot>
              {canCreateModule &&
                (activeType === "all" ||
                  canCreateFeedModule(FEED_MODULE_REGISTRY[activeType], {
                    canAdministerBookClub,
                  })) && (
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className={styles.createInlineButton}
                    aria-label={createLabel}
                    title={createLabel}
                  >
                    +
                  </button>
                )}
            </div>
          </div>
          <div className={styles.feedCategoryRow} data-feed-category-row>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={styles.feedMenuButton}
              aria-label="Open feed menu"
              aria-controls="group-feed-menu"
              aria-expanded={drawerOpen}
            >
              <span className={styles.feedMenuIcon} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>
            <ModuleTabs
              activeType={activeType}
              counts={moduleCounts}
              moduleTypes={moduleTypes}
              onSelect={selectModuleType}
              swipeOffset={feedSwipeOffset}
              swipePhase={feedSwipePhase}
              swipeTravelDistance={feedSwipeTravelDistance}
            />
          </div>
        </div>

        <main
          className={styles.feedColumn}
          data-feed-swipe-surface
          onPointerDown={handleFeedPointerDown}
          onPointerMove={handleFeedPointerMove}
          onPointerUp={handleFeedPointerUp}
          onClickCapture={handleFeedClickCapture}
          onPointerCancel={handleFeedPointerCancel}
        >
          <div
            className={cx(
              styles.feedViewport,
              deferredCategoryOffset ||
                convertingDeferredOffset ||
                (feedSwipeScrollSnapshot &&
                  !feedSwipeScrollSnapshot.hasEnteredFeed)
                ? styles.feedViewportAnchored
                : "",
            )}
            data-feed-swipe-phase={feedSwipePhase}
          >
            {visiblePanelTypes.map((type) => {
              const isActivePanel = type === activeType;
              const verticalOffset = panelVerticalOffset(type);
              return (
                <div
                  key={type}
                  id={isActivePanel ? `feed-panel-${type}` : undefined}
                  role={isActivePanel ? "tabpanel" : undefined}
                  aria-labelledby={
                    isActivePanel ? `feed-tab-${type}` : undefined
                  }
                  onTransitionEnd={
                    isActivePanel ? handleFeedPanelTransitionEnd : undefined
                  }
                  className={cx(
                    styles.feedPanel,
                    isActivePanel ? "" : styles.feedPanelAdjacent,
                    feedSwipePhase === "dragging" ||
                      feedSwipePhase === "preparing" ||
                      (isActivePanel && convertingDeferredOffset)
                      ? styles.feedPanelDirect
                      : "",
                  )}
                  style={{
                    transform: `translate3d(${panelHorizontalOffset(type)}, ${
                      verticalOffset ? `${verticalOffset}px` : "0"
                    }, 0)`,
                  }}
                  data-feed-panel-type={type}
                  aria-hidden={isActivePanel ? undefined : "true"}
                  inert={isActivePanel ? undefined : ""}
                >
                  {renderFeedPanel(type, isActivePanel)}
                </div>
              );
            })}
          </div>
        </main>
      </div>

      {createModalOpen && (
        <ModalShell
          title={createTitle}
          onClose={() => setCreateModalOpen(false)}
          widthClassName={styles.createModal}
        >
          {renderCreateContent()}
        </ModalShell>
      )}
      {editingModule && (
        <ModalShell
          title={FEED_MODULE_REGISTRY[editingModule.type].edit.label}
          onClose={() => setEditingModule(null)}
          widthClassName={styles.createModal}
        >
          {renderFeedModuleEdit(FEED_MODULE_REGISTRY[editingModule.type], {
            module: editingModule,
            roommates,
            onChanged: refreshModules,
            onSaved: async () => {
              await refreshModules();
              setEditingModule(null);
            },
            onClose: () => setEditingModule(null),
            onCancel: () => setEditingModule(null),
          })}
        </ModalShell>
      )}
    </section>
  );
}
