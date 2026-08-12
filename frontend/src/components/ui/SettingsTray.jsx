import { useCallback, useEffect, useRef, useState } from "react";
import BottomTray from "./BottomTray.jsx";

export default function SettingsTray({
  title,
  onClose,
  widthClassName,
  screens,
  renderMenu,
}) {
  const [activeScreenId, setActiveScreenId] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [restoreFocusId, setRestoreFocusId] = useState(null);
  const returnFocusIdRef = useRef(null);
  const activeScreen = screens.find((screen) => screen.id === activeScreenId);

  useEffect(() => {
    if (activeScreenId || !restoreFocusId) return;
    const returnTarget = [...document.querySelectorAll("[data-settings-screen-id]")]
      .find((element) => element.dataset.settingsScreenId === restoreFocusId);
    returnTarget?.focus();
    setRestoreFocusId(null);
  }, [activeScreenId, restoreFocusId]);

  const openScreen = useCallback((screenId, trigger) => {
    returnFocusIdRef.current = trigger?.dataset.settingsScreenId ?? screenId;
    setActiveScreenId(screenId);
    setExpanded(true);
  }, []);

  const handleBack = useCallback(() => {
    const returnFocusId = returnFocusIdRef.current;
    setActiveScreenId(null);
    setExpanded(false);
    setRestoreFocusId(returnFocusId);
  }, []);

  return (
    <BottomTray
      title={activeScreen?.title ?? title}
      ariaLabel={title}
      onClose={onClose}
      onBack={activeScreen ? handleBack : undefined}
      expanded={expanded}
      onExpand={() => setExpanded(true)}
      widthClassName={widthClassName}
    >
      {activeScreen ? activeScreen.content : renderMenu(openScreen)}
    </BottomTray>
  );
}
