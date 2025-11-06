/**
 * Hook for managing context menus
 */

import { useState, useCallback } from "react";
import { ContextMenuItem } from "../components/ContextMenu";

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    items: [],
  });

  const showMenu = useCallback((x: number, y: number, items: ContextMenuItem[]) => {
    setMenu({ visible: true, x, y, items });
  }, []);

  const hideMenu = useCallback(() => {
    setMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  return { menu, showMenu, hideMenu };
}

