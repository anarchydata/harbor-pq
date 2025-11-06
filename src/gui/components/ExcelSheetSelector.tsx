/**
 * Modal dialog for selecting Excel sheets or tables
 */

import React, { useState, useEffect } from "react";
import "./ExcelSheetSelector.css";

export interface SheetOrTable {
  name: string;
  item: string;
  kind: "Sheet" | "Table";
  hidden: boolean;
}

interface ExcelSheetSelectorProps {
  isOpen: boolean;
  sheets: SheetOrTable[];
  tables: SheetOrTable[];
  onSelect: (selection: SheetOrTable) => void;
  onCancel: () => void;
}

export function ExcelSheetSelector({
  isOpen,
  sheets,
  tables,
  onSelect,
  onCancel,
}: ExcelSheetSelectorProps) {
  const [selectedItem, setSelectedItem] = useState<SheetOrTable | null>(null);

  useEffect(() => {
    // Reset selection when dialog opens
    if (isOpen) {
      setSelectedItem(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const allItems = [...tables, ...sheets].filter((item) => !item.hidden);

  const handleSelect = () => {
    if (selectedItem) {
      onSelect(selectedItem);
    }
  };

  return (
    <div className="excel-sheet-selector-overlay" onClick={onCancel}>
      <div className="excel-sheet-selector-modal" onClick={(e) => e.stopPropagation()}>
        <div className="excel-sheet-selector-header">
          <h2>Select Sheet or Table</h2>
          <button className="excel-sheet-selector-close" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="excel-sheet-selector-content">
          {allItems.length === 0 ? (
            <p className="excel-sheet-selector-empty">No sheets or tables found</p>
          ) : (
            <div className="excel-sheet-selector-list">
              {tables.length > 0 && (
                <div className="excel-sheet-selector-group">
                  <h3>Tables</h3>
                  {tables
                    .filter((item) => !item.hidden)
                    .map((item) => (
                      <div
                        key={`table-${item.name}`}
                        className={`excel-sheet-selector-item ${
                          selectedItem?.name === item.name && selectedItem?.kind === item.kind
                            ? "selected"
                            : ""
                        }`}
                        onClick={() => setSelectedItem(item)}
                      >
                        <span className="excel-sheet-selector-name">{item.name}</span>
                        <span className="excel-sheet-selector-type">Table</span>
                      </div>
                    ))}
                </div>
              )}
              {sheets.length > 0 && (
                <div className="excel-sheet-selector-group">
                  <h3>Sheets</h3>
                  {sheets
                    .filter((item) => !item.hidden)
                    .map((item) => (
                      <div
                        key={`sheet-${item.name}`}
                        className={`excel-sheet-selector-item ${
                          selectedItem?.name === item.name && selectedItem?.kind === item.kind
                            ? "selected"
                            : ""
                        }`}
                        onClick={() => setSelectedItem(item)}
                      >
                        <span className="excel-sheet-selector-name">{item.name}</span>
                        <span className="excel-sheet-selector-type">Sheet</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="excel-sheet-selector-footer">
          <button className="excel-sheet-selector-button cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="excel-sheet-selector-button primary"
            onClick={handleSelect}
            disabled={!selectedItem}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

