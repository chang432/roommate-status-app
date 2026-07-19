import { createContext, useContext, useEffect } from "react";

const ModuleFocusContext = createContext(null);

export function ModuleFocusProvider({ intent, children }) {
  return (
    <ModuleFocusContext.Provider value={intent}>
      {children}
    </ModuleFocusContext.Provider>
  );
}

// Expandable renderers opt in without coupling local UI state to feed polling.
// Static modules still receive automatic wrapper-level scrolling.
// eslint-disable-next-line react-refresh/only-export-components -- hook belongs to this context
export function useExpandOnModuleFocus(setExpandedId) {
  const intent = useContext(ModuleFocusContext);
  const itemId = intent?.itemId;
  const token = intent?.token;

  useEffect(() => {
    if (!itemId || !token) return;
    setExpandedId(itemId);
  }, [itemId, setExpandedId, token]);
}
