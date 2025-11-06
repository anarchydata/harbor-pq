/**
 * Deterministic rule-based intent matching
 * Patterns and synonyms for fast intent classification
 */

import { Intent, IntentArgs, IntentResult } from "./intentTypes";

interface RulePattern {
  pattern: RegExp;
  intent: Intent;
  extractArgs: (match: RegExpMatchArray, text: string) => IntentArgs;
  confidence: number;
}

// Common filler words to remove during normalization
const FILLER_WORDS = /\b(please|can you|could you|would you|i want|i need|i'd like|let me|make|create|do|add|show|display)\b/gi;

// Normalize user input text
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(FILLER_WORDS, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Rule patterns for workspace intents
const workspaceRules: RulePattern[] = [
  // workspace.new_query
  {
    pattern: /^(new|create|add|make)\s+(query|q)\s*(?:named|called|with name)?\s*(?:["']?([^"']+)["']?)?$/i,
    intent: "workspace.new_query",
    extractArgs: (match) => ({ name: match[3] }),
    confidence: 0.98,
  },
  {
    pattern: /^(new|create|add)\s+(query|q)$/i,
    intent: "workspace.new_query",
    extractArgs: () => ({}),
    confidence: 0.95,
  },

  // workspace.delete_query
  {
    pattern: /^(delete|remove|drop)\s+(query|q)\s*(?:named|called)?\s*(?:["']?([^"']+)["']?)?$/i,
    intent: "workspace.delete_query",
    extractArgs: (match) => ({ name: match[3] || match[2] }),
    confidence: 0.98,
  },
  {
    pattern: /^(delete|remove)\s+["']?([^"']+)["']?$/i,
    intent: "workspace.delete_query",
    extractArgs: (match) => ({ name: match[2] }),
    confidence: 0.95,
  },

  // workspace.rename_query
  {
    pattern: /^(rename|change name|re?:?name)\s+(query|q)\s*(?:named|called)?\s*(?:["']?([^"']+)["']?)\s+(?:to|as|into)\s*(?:["']?([^"']+)["']?)$/i,
    intent: "workspace.rename_query",
    extractArgs: (match) => ({ old: match[3] || match[2], new: match[4] }),
    confidence: 0.98,
  },
  {
    pattern: /^(rename|re?:?name)\s+["']?([^"']+)["']?\s+(?:to|as|into)\s*(?:["']?([^"']+)["']?)$/i,
    intent: "workspace.rename_query",
    extractArgs: (match) => ({ old: match[2], new: match[3] }),
    confidence: 0.95,
  },

  // workspace.open_file
  {
    pattern: /^(open|load|file|view)\s+(?:file\s+)?(?:["']?([^"']+)["']?|(.+))$/i,
    intent: "workspace.open_file",
    extractArgs: (match) => ({ path: match[2] || match[3] }),
    confidence: 0.95,
  },
  {
    pattern: /^open\s+(.+)$/i,
    intent: "workspace.open_file",
    extractArgs: (match) => ({ path: match[1] }),
    confidence: 0.90,
  },

  // workspace.switch_query
  {
    pattern: /^(switch|change|use|select|goto)\s+(?:to\s+)?(?:query\s+)?(?:named\s+)?(?:["']?([^"']+)["']?)$/i,
    intent: "workspace.switch_query",
    extractArgs: (match) => ({ name: match[3] || match[2] }),
    confidence: 0.95,
  },

  // workspace.export
  {
    pattern: /^export\s+(?:as\s+)?(csv|xlsx|pbit|excel|power.?bi)(?:\s+(?:sheet|tab)\s+(?:["']?([^"']+)["']?))?$/i,
    intent: "workspace.export",
    extractArgs: (match) => {
      const format = match[1] === "excel" ? "xlsx" : match[1] === "power.?bi" ? "pbit" : match[1] as "csv" | "xlsx" | "pbit";
      return { format, sheet: match[2] };
    },
    confidence: 0.95,
  },
  {
    pattern: /^export$/i,
    intent: "workspace.export",
    extractArgs: () => ({ format: "csv" }),
    confidence: 0.85,
  },

  // workspace.list_steps
  {
    pattern: /^(list|show|display|get)\s+(?:all\s+)?(?:steps|queries)$/i,
    intent: "workspace.list_steps",
    extractArgs: () => ({}),
    confidence: 0.95,
  },
  {
    pattern: /^(steps|queries)$/i,
    intent: "workspace.list_steps",
    extractArgs: () => ({}),
    confidence: 0.90,
  },

  // workspace.preview_step
  {
    pattern: /^(preview|show|view|display|see)\s+(?:step|query)\s+(?:named\s+)?(?:["']?([^"']+)["']?)$/i,
    intent: "workspace.preview_step",
    extractArgs: (match) => ({ name: match[2] }),
    confidence: 0.95,
  },

  // workspace.connect_excel
  {
    pattern: /^(connect|link|attach|import)\s+(?:to\s+)?(?:excel|file)\s+(?:["']?([^"']+)["']?|(.+))$/i,
    intent: "workspace.connect_excel",
    extractArgs: (match) => ({ path: match[3] || match[4] }),
    confidence: 0.95,
  },
];

// Rule patterns for code intents
const codeRules: RulePattern[] = [
  // code.rename_all_steps_semantic
  {
    pattern: /^(rename|refactor|update)\s+(?:all\s+)?(?:steps|queries)\s+(?:semantically|with semantic|using semantic)$/i,
    intent: "code.rename_all_steps_semantic",
    extractArgs: () => ({}),
    confidence: 0.95,
  },
  {
    pattern: /^(semantic\s+)?(rename|refactor)\s+(?:all\s+)?steps$/i,
    intent: "code.rename_all_steps_semantic",
    extractArgs: () => ({}),
    confidence: 0.90,
  },

  // code.insert_before
  {
    pattern: /^(insert|add|create)\s+(?:step|query)\s+(?:before|above)\s+(?:step\s+)?(?:named\s+)?(?:["']?([^"']+)["']?)$/i,
    intent: "code.insert_before",
    extractArgs: (match) => ({ step: match[2] }),
    confidence: 0.95,
  },

  // code.insert_after
  {
    pattern: /^(insert|add|create)\s+(?:step|query)\s+(?:after|below)\s+(?:step\s+)?(?:named\s+)?(?:["']?([^"']+)["']?)$/i,
    intent: "code.insert_after",
    extractArgs: (match) => ({ step: match[2] }),
    confidence: 0.95,
  },

  // code.replace_step
  {
    pattern: /^(replace|update|change)\s+(?:step|query)\s+(?:named\s+)?(?:["']?([^"']+)["']?)$/i,
    intent: "code.replace_step",
    extractArgs: (match) => ({ name: match[2] }),
    confidence: 0.95,
  },

  // code.remove_step
  {
    pattern: /^(remove|delete|drop)\s+(?:step|query)\s+(?:named\s+)?(?:["']?([^"']+)["']?)$/i,
    intent: "code.remove_step",
    extractArgs: (match) => ({ name: match[2] }),
    confidence: 0.95,
  },

  // code.explain_step
  {
    pattern: /^(explain|describe|what\s+does|show\s+details\s+of)\s+(?:step|query)\s+(?:named\s+)?(?:["']?([^"']+)["']?)$/i,
    intent: "code.explain_step",
    extractArgs: (match) => ({ name: match[2] }),
    confidence: 0.95,
  },
];

// Combine all rules
const allRules: RulePattern[] = [...workspaceRules, ...codeRules];

/**
 * Match user input against rule patterns
 * Returns null if no match found
 */
export function matchRule(text: string): IntentResult | null {
  const normalized = normalizeText(text);

  // Try each rule pattern
  for (const rule of allRules) {
    const match = normalized.match(rule.pattern);
    if (match) {
      const args = rule.extractArgs(match, normalized);
      return {
        intent: rule.intent,
        args,
        confidence: rule.confidence,
        source: "rule",
      };
    }
  }

  return null;
}

