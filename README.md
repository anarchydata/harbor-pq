# Harbor PQ - Hybrid Intent Parser

A hybrid command router that classifies user instructions as either workspace-level or code-level intents using deterministic rule matching with LLM fallback.

## Features

- **Fast Rule-Based Matching**: Deterministic string/regex patterns for common phrases
- **LLM Fallback**: GPT-4o API integration when rules don't match
- **Structured Output**: Always returns JSON with intent, args, confidence, and source
- **Modern GUI**: React-based web interface for testing and visualization

## Project Structure

```
src/
├── intentTypes.ts          # Type definitions
├── intentRules.ts          # Pattern matching rules and synonyms
├── classifyIntentLLM.ts    # GPT-4o API integration
├── intentParser.ts         # Main parsing function
├── example.ts              # Usage examples
└── gui/
    ├── App.tsx             # React GUI component
    ├── App.css             # Styling
    └── index.tsx           # GUI entry point
```

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up OpenAI API key:
```bash
export OPENAI_API_KEY=your_api_key_here
```

Or create a `.env` file:
```
OPENAI_API_KEY=your_api_key_here
```

3. Build the project:
```bash
npm run build
```

## Usage

### Programmatic Usage

```typescript
import { parseUserIntent } from "./intentParser";

// Example 1: Rule-based match (fast)
const result1 = await parseUserIntent("create new query named Sales");
// { intent: "workspace.new_query", args: { name: "Sales" }, confidence: 0.98, source: "rule" }

// Example 2: Workspace export
const result2 = await parseUserIntent("export as xlsx with sheet Orders");
// { intent: "workspace.export", args: { format: "xlsx", sheet: "Orders" }, confidence: 0.95, source: "rule" }

// Example 3: Code-level intent
const result3 = await parseUserIntent("insert step after FilterRows");
// { intent: "code.insert_after", args: { step: "FilterRows" }, confidence: 0.95, source: "rule" }

// Integration with agent layer
async function handleUserCommand(userInput: string) {
  const intent = await parseUserIntent(userInput);
  
  if (intent.intent === "clarify") {
    return { action: "ask_clarification", message: intent.args.message };
  }
  
  if (intent.intent.startsWith("workspace.")) {
    return handleWorkspaceIntent(intent);
  } else if (intent.intent.startsWith("code.")) {
    return handleCodeIntent(intent);
  }
}
```

### GUI Usage

1. Build the project:
```bash
npm run build
```

2. Set your OpenAI API key (create `.env` file or export):
```bash
export OPENAI_API_KEY=your_api_key_here
```

3. Start the server:
```bash
npm start
```

4. Open your browser and navigate to:
```
http://localhost:3000
```

## VS Code-Style GUI

The Power Query IDE features a VS Code-inspired interface with:

### Layout
- **Two-column split (60:40)**: Left work area, right chat panel
- **Left column split (55:45)**: Top data frame preview, bottom M-code editor
- **Draggable gutters**: Resize panes by dragging; double-click to reset
- **VS Code-style tabs**: Multiple query tabs with close/rename/duplicate
- **Status bar**: Query info, connection state, diagnostics, cursor position

### Features
- **Data Frame Preview**: Grid with toolbar (Refresh, Step Preview, Filter, Find, Export)
- **M-Code Editor**: Syntax highlighting, step gutter markers, toolbar actions
- **Chat Panel**: Intent strip showing parsed intents, quick action chips, composer
- **Keyboard Shortcuts**: 
  - `F5` - Run step
  - `Ctrl+F5` - Run all
  - `Ctrl+K R` - Rename all steps
  - `Ctrl+I B/A` - Insert before/after
  - `Ctrl+S` - Save
  - `Ctrl+P` - Switch query
  - `Ctrl+Enter` - Send chat message
  - `Esc` - Blur input

### Theming
- Dark theme (default, VS Code Dark+)
- Light theme support (VS Code Light+)
- CSS variables for easy customization
- Codicon icons matching VS Code

### Persistence
- Split pane sizes saved to localStorage
- Last open query restored
- Last selected step remembered
- Editor scroll position preserved

## Intent Schema

### Workspace Intents
- `workspace.new_query [name?]` - Create a new query
- `workspace.delete_query [name]` - Delete a query by name
- `workspace.rename_query [old, new]` - Rename a query
- `workspace.open_file [path]` - Open a file
- `workspace.switch_query [name]` - Switch to a different query
- `workspace.export [format: csv|xlsx|pbit, sheet?]` - Export data
- `workspace.list_steps` - List all steps/queries
- `workspace.preview_step [name]` - Preview a step
- `workspace.connect_excel [path]` - Connect to Excel file

### Code Intents
- `code.rename_all_steps_semantic` - Rename all steps semantically
- `code.insert_before [step]` - Insert step before another
- `code.insert_after [step]` - Insert step after another
- `code.replace_step [name]` - Replace a step
- `code.remove_step [name]` - Remove a step
- `code.explain_step [name]` - Explain what a step does

## Response Format

All intents return a structured JSON object:

```typescript
{
  intent: "workspace.new_query" | "code.insert_after" | "clarify" | ...,
  args: {
    name?: string,
    path?: string,
    format?: "csv" | "xlsx" | "pbit",
    // ... other args
  },
  confidence: 0.0 - 1.0,
  source: "rule" | "llm"
}
```

If confidence < 0.7, the intent is set to `"clarify"` with a message asking the user to restate.

## License

MIT

