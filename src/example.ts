/**
 * Usage example showing integration with the app's agent layer
 */

import { parseUserIntent } from "./intentParser";

// 5-line integration example:
// const intent = await parseUserIntent(userMessage);
// if (intent.intent === "clarify") return { reply: intent.args.message };
// if (intent.intent.startsWith("workspace.")) await handleWorkspace(intent);
// if (intent.intent.startsWith("code.")) await handleCode(intent);

// Example 1: Rule-based match (fast)
async function example1() {
  const result = await parseUserIntent("create new query named Sales");
  console.log(result);
  // { intent: "workspace.new_query", args: { name: "Sales" }, confidence: 0.98, source: "rule" }
}

// Example 2: Workspace export
async function example2() {
  const result = await parseUserIntent("export as xlsx with sheet Orders");
  console.log(result);
  // { intent: "workspace.export", args: { format: "xlsx", sheet: "Orders" }, confidence: 0.95, source: "rule" }
}

// Example 3: Code-level intent
async function example3() {
  const result = await parseUserIntent("insert step after FilterRows");
  console.log(result);
  // { intent: "code.insert_after", args: { step: "FilterRows" }, confidence: 0.95, source: "rule" }
}

// Example 4: Integration with agent layer
async function handleUserCommand(userInput: string) {
  const intent = await parseUserIntent(userInput);
  
  if (intent.intent === "clarify") {
    return { action: "ask_clarification", message: intent.args.message };
  }
  
  // Route to appropriate handler based on intent
  if (intent.intent.startsWith("workspace.")) {
    return handleWorkspaceIntent(intent);
  } else if (intent.intent.startsWith("code.")) {
    return handleCodeIntent(intent);
  }
}

function handleWorkspaceIntent(intent: any) {
  // Workspace handler logic
  return { action: intent.intent, params: intent.args };
}

function handleCodeIntent(intent: any) {
  // Code handler logic
  return { action: intent.intent, params: intent.args };
}

// Run examples
if (require.main === module) {
  Promise.all([example1(), example2(), example3()]).catch(console.error);
}

