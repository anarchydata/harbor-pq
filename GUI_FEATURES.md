# VS Code-Style Power Query IDE GUI

## Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│ Tabs Bar (Query1, Query2, ...)                    [+]  │
├──────────────────────────┬─────────────────────────────┤
│                          │  Assistant — GPT-5          │
│  Data Frame Preview      │  ┌─────────────────────────┐ │
│  ┌────────────────────┐  │  │ Chat Messages           │ │
│  │ Toolbar            │  │  │                         │ │
│  ├────────────────────┤  │  │                         │ │
│  │ Grid               │  │  │                         │ │
│  │                    │  │  └─────────────────────────┘ │
│  └────────────────────┘  │  Intent Strip              │
│ ═══════════════════════  │  Quick Actions              │
│  M-Code Editor           │  ┌─────────────────────────┐ │
│  ┌────────────────────┐  │  │ Composer                 │ │
│  │ Toolbar           │  │  │                         │ │
│  ├────────────────────┤  │  └─────────────────────────┘ │
│  │ Step | Code       │  │                             │
│  │ Gutter| Editor    │  │                             │
│  └────────────────────┘  │                             │
└──────────────────────────┴─────────────────────────────┘
│ Status Bar: Query • Step • Rows • Connection • Errors │
└─────────────────────────────────────────────────────────┘
```

## Component Breakdown

### 1. TabsBar
- VS Code-style tabs with active/inactive states
- Middle-click to close
- Right-click context menu (Rename, Duplicate, Close, Close Others)
- "+" button to create new query
- Dirty indicator for unsaved changes

### 2. DataFramePreview
- Toolbar with actions:
  - Refresh (Ctrl+R)
  - Step Preview dropdown
  - Filter toggle
  - Find Column (/)
  - Export
- Scrollable grid with sticky headers
- Column context menu (Sort, Pin, Hide, Settings)
- Row/column selection

### 3. MCodeEditor
- Toolbar with actions:
  - Run Step (F5)
  - Run All (Ctrl+F5)
  - Format
  - Rename All Steps (Ctrl+K R)
  - Insert Before (Ctrl+I B)
  - Insert After (Ctrl+I A)
- Step gutter with markers
- Line numbers
- Syntax highlighting (can be enhanced)
- Step context menu (Preview, Insert Before/After, Replace, Remove, Explain)

### 4. ChatPanel
- Header: "Assistant — GPT-5"
- Message display (user/assistant, left/right alignment)
- Intent strip showing parsed intent with color coding:
  - Green: Rule-based match
  - Blue: LLM match
  - Red: Clarify needed
- Quick action chips:
  - New Query
  - List Steps
  - Export CSV
  - Rename Steps
- Composer:
  - Enter to send
  - Shift+Enter for newline
  - Ctrl+Enter to send
  - Esc to blur

### 5. StatusBar
- Left: Current query • Current step • Row/column count
- Center: Connection state (Excel connected, Local file, Unsaved)
- Right: Diagnostics count, Last run time, Editor line/col

### 6. SplitPane
- Draggable gutters
- Double-click to reset to default size
- Persists sizes to localStorage
- Horizontal and vertical directions
- Min/max size constraints

## Keyboard Shortcuts

### Editor
- `F5` - Run current step
- `Ctrl+F5` - Run all steps
- `Ctrl+K R` - Rename all steps semantically
- `Ctrl+I B` - Insert step before
- `Ctrl+I A` - Insert step after
- `Ctrl+S` - Save query
- `Ctrl+P` - Switch query

### Chat
- `Ctrl+Enter` - Send message
- `Enter` - Send message
- `Shift+Enter` - New line
- `Esc` - Blur input

### Grid
- `/` - Focus column search
- `Ctrl+F` - Find in grid
- `A` - Select all

## Context Menus

### Grid Header
- Sort Ascending
- Sort Descending
- Pin Column
- Hide Column
- Column Settings

### Step Gutter
- Preview Step
- Insert Before
- Insert After
- Replace Step
- Remove Step
- Explain Step

### Tab
- Rename
- Duplicate
- Close
- Close Others

## Theming

Uses CSS variables following VS Code Dark+/Light+ palette:
- `--bg` - Background
- `--panel` - Panel background
- `--border` - Borders
- `--text` - Text color
- `--muted` - Muted text
- `--accent` - Accent color
- `--success` - Success color
- `--warning` - Warning color
- `--error` - Error color

Toggle theme with: `document.documentElement.setAttribute("data-theme", "light")`

## Persistence

All stored in localStorage:
- `pq-tabs` - Tab state
- `pq-last-query` - Last active query ID
- `pq-last-step` - Last selected step
- `pq-split-horizontal` - Horizontal split size
- `pq-split-vertical` - Vertical split size
- `pq-theme` - Theme preference

## IPC Integration (Electron)

When wrapped in Electron, these IPC messages should be implemented:

### Renderer → Main
- `open-file` - Open file dialog
- `connect-excel` - Connect to Excel file
- `export` - Export data (csv/xlsx/pbit)
- `run-step` - Execute current step
- `run-all` - Execute all steps

### Main → Renderer
- `dataframe:update` - Update preview data
- `diagnostics:update` - Update error/warning count
- `export:done|error` - Export completion/error
- `excel:connected` - Excel connection status

## Error States

- **Parsing error**: Red status badge + problems list
- **Stale preview**: Banner in grid when data is outdated
- **Export fail**: Toast notification with error + copyable log ID
- **Excel path invalid**: Inline error under connect control

