/**
 * VS Code-style tabs bar
 */

import React, { useState } from "react";
import "./TabsBar.css";

export interface Tab {
  id: string;
  name: string;
  isActive: boolean;
  isDirty?: boolean;
}

interface TabsBarProps {
  tabs: Tab[];
  onTabClick: (id: string) => void;
  onTabClose: (id: string, event: React.MouseEvent) => void;
  onTabContextMenu: (id: string, event: React.MouseEvent) => void;
  onNewTab: () => void;
}

export function TabsBar({
  tabs,
  onTabClick,
  onTabClose,
  onTabContextMenu,
  onNewTab,
}: TabsBarProps) {
  const handleMiddleClick = (id: string, e: React.MouseEvent) => {
    if (e.button === 1) {
      // Middle click
      onTabClose(id, e);
    }
  };

  return (
    <div className="tabs-bar">
      <div className="tabs-container">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${tab.isActive ? "tab-active" : ""}`}
            onClick={() => onTabClick(tab.id)}
            onMouseDown={(e) => handleMiddleClick(tab.id, e)}
            onContextMenu={(e) => onTabContextMenu(tab.id, e)}
          >
            <span className="tab-label">{tab.name}</span>
            {tab.isDirty && <span className="tab-dirty-indicator">●</span>}
            <button
              className="tab-close-button"
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id, e);
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="tabs-new-button" onClick={onNewTab} title="New Query">
        +
      </button>
    </div>
  );
}

