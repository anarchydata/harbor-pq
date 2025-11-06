/**
 * Type definitions for the intent parsing system
 */

export type WorkspaceIntent =
  | "workspace.new_query"
  | "workspace.delete_query"
  | "workspace.rename_query"
  | "workspace.open_file"
  | "workspace.switch_query"
  | "workspace.export"
  | "workspace.list_steps"
  | "workspace.preview_step"
  | "workspace.connect_excel";

export type CodeIntent =
  | "code.rename_all_steps_semantic"
  | "code.insert_before"
  | "code.insert_after"
  | "code.replace_step"
  | "code.remove_step"
  | "code.explain_step";

export type Intent = WorkspaceIntent | CodeIntent | "clarify";

export interface IntentArgs {
  name?: string;
  old?: string;
  new?: string;
  path?: string;
  format?: "csv" | "xlsx" | "pbit";
  sheet?: string;
  step?: string;
  message?: string;
  [key: string]: string | undefined;
}

export interface IntentResult {
  intent: Intent;
  args: IntentArgs;
  confidence: number;
  source: "rule" | "llm";
}

