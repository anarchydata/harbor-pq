/**
 * Main intent parser - hybrid rule-based and LLM classifier
 * Exports parseUserIntent function
 */

import { IntentResult } from "./intentTypes";
import { matchRule } from "./intentRules";
import { classifyIntentLLM } from "./classifyIntentLLM";

/**
 * Parse user intent from natural language input
 * Uses rule-based matching first, falls back to LLM if no match
 * 
 * @param message - User input message
 * @returns Promise<IntentResult> - Structured intent result
 * 
 * @example
 * const result = await parseUserIntent("create new query named Sales");
 * // { intent: "workspace.new_query", args: { name: "Sales" }, confidence: 0.98, source: "rule" }
 */
export async function parseUserIntent(message: string): Promise<IntentResult> {
  // Step 1: Try rule-based matching first (fast, deterministic)
  const ruleMatch = matchRule(message);
  if (ruleMatch) {
    return ruleMatch;
  }

  // Step 2: Fall back to LLM classification
  const llmResult = await classifyIntentLLM(message);

  // Step 3: If LLM confidence is too low, return clarify intent
  if (llmResult.confidence < 0.7) {
    return {
      intent: "clarify",
      args: { message: "Unclear intent, please restate." },
      confidence: 0.0,
      source: "llm",
    };
  }

  return llmResult;
}

// Export types for external use
export * from "./intentTypes";

