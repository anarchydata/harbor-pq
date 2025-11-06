# Usage Example - 5-Line Integration

Here's how to integrate the intent parser with your app's agent layer:

```typescript
import { parseUserIntent } from "./intentParser";

// In your agent's message handler:
const intent = await parseUserIntent(userMessage);
if (intent.intent === "clarify") return { reply: intent.args.message };
if (intent.intent.startsWith("workspace.")) await handleWorkspace(intent);
if (intent.intent.startsWith("code.")) await handleCode(intent);
```

This 5-line integration:
1. Parses user input (rule-based fast, LLM fallback)
2. Handles clarification requests
3. Routes workspace intents to workspace handler
4. Routes code intents to code handler
5. All with structured JSON responses and confidence scores

