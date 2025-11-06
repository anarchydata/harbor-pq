/**
 * LLM-based intent classification using GPT-5 API
 * Fallback when rule-based matching fails
 */

import { Intent, IntentArgs, IntentResult } from "./intentTypes";
import OpenAI from "openai";

// Load environment variables
try {
  require("dotenv").config();
} catch (e) {
  // dotenv not available, use system env vars
}

// Initialize OpenAI client with Azure OpenAI support
const apiKey = process.env.OPENAI_API_KEY || "";
const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT || "";
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-35-turbo";
const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview";

const openai = new OpenAI({
  apiKey: apiKey,
  baseURL: azureEndpoint ? `${azureEndpoint}openai/deployments/${deployment}` : undefined,
  defaultQuery: azureEndpoint ? { "api-version": apiVersion } : undefined,
  defaultHeaders: azureEndpoint ? { "api-key": apiKey } : undefined,
});

const INTENT_SCHEMA = {
  workspace: [
    "workspace.new_query",
    "workspace.delete_query",
    "workspace.rename_query",
    "workspace.open_file",
    "workspace.switch_query",
    "workspace.export",
    "workspace.list_steps",
    "workspace.preview_step",
    "workspace.connect_excel",
  ],
  code: [
    "code.rename_all_steps_semantic",
    "code.insert_before",
    "code.insert_after",
    "code.replace_step",
    "code.remove_step",
    "code.explain_step",
  ],
};

const SYSTEM_PROMPT = `You are an intent classifier for a query/workspace management system. 
Classify user instructions into one of these intents:

WORKSPACE INTENTS:
- workspace.new_query [name?] - Create a new query
- workspace.delete_query [name] - Delete a query by name
- workspace.rename_query [old, new] - Rename a query
- workspace.open_file [path] - Open a file
- workspace.switch_query [name] - Switch to a different query
- workspace.export [format: csv|xlsx|pbit, sheet?] - Export data
- workspace.list_steps - List all steps/queries
- workspace.preview_step [name] - Preview a step
- workspace.connect_excel [path] - Connect to Excel file

CODE INTENTS:
- code.rename_all_steps_semantic - Rename all steps semantically
- code.insert_before [step] - Insert step before another
- code.insert_after [step] - Insert step after another
- code.replace_step [name] - Replace a step
- code.remove_step [name] - Remove a step
- code.explain_step [name] - Explain what a step does

Return ONLY a valid JSON object with this exact structure:
{
  "intent": "<one of the intents above>",
  "args": { ... } // appropriate args for the intent
}

If the intent is unclear, return:
{
  "intent": "clarify",
  "args": { "message": "Unclear intent, please restate." }
}`;

/**
 * Classify user intent using GPT-5 API
 * @param message - User input message
 * @returns Promise<IntentResult>
 */
export async function classifyIntentLLM(message: string): Promise<IntentResult> {
  try {
    if (!apiKey || apiKey === "") {
      console.warn("[classifyIntentLLM] OPENAI_API_KEY not configured");
      return {
        intent: "clarify",
        args: { message: "OpenAI API key not configured" },
        confidence: 0.0,
        source: "llm",
      };
    }

    const response = await openai.chat.completions.create({
      model: azureEndpoint ? deployment : "gpt-4o", // Use deployment name for Azure
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        intent: "clarify",
        args: { message: "No response from LLM" },
        confidence: 0.0,
        source: "llm",
      };
    }

    const parsed = JSON.parse(content);
    const confidence = parsed.confidence || 0.8; // Default confidence for LLM

    // Validate intent is in the schema
    const allIntents = [...INTENT_SCHEMA.workspace, ...INTENT_SCHEMA.code, "clarify"];
    const intent = allIntents.includes(parsed.intent) ? parsed.intent : "clarify";

    return {
      intent: intent as Intent,
      args: parsed.args || {},
      confidence: confidence < 0.7 ? 0.0 : confidence,
      source: "llm",
    };
  } catch (error) {
    console.error("LLM classification error:", error);
    return {
      intent: "clarify",
      args: { message: "Error processing request. Please try again." },
      confidence: 0.0,
      source: "llm",
    };
  }
}

