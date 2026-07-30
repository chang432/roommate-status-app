import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmDialog from "./ConfirmDialog.jsx";

// Promise-based confirmation keeps destructive handlers linear while all
// confirmation behavior and presentation remain consistent across features.
export function useConfirmDialog() {
  const [options, setOptions] = useState(null);
  const resolverRef = useRef(null);

  const settle = useCallback((confirmed) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolve?.(confirmed);
  }, []);

  const confirm = useCallback((nextOptions) => new Promise((resolve) => {
    resolverRef.current?.(false);
    resolverRef.current = resolve;
    setOptions(nextOptions);
  }), []);

  useEffect(() => () => {
    resolverRef.current?.(false);
    resolverRef.current = null;
  }, []);

  return {
    confirm,
    confirmationDialog: options ? (
      <ConfirmDialog
        {...options}
        onCancel={() => settle(false)}
        onConfirm={() => settle(true)}
      />
    ) : null,
  };
}
