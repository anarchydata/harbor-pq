/**
 * Express server for serving GUI and handling intent parsing API
 */

import express from "express";
import path from "path";
import { parseUserIntent } from "./intentParser";
import { IntentResult } from "./intentTypes";
import OpenAI from "openai";
import { CHAT_SYSTEM_PROMPT } from "./prompts/chatPrompt";

// Load environment variables
try {
  require("dotenv").config();
} catch (e) {
  // dotenv not available, use system env vars
}

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "..")));

// API endpoint for intent parsing
app.post("/api/parse", async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    const result: IntentResult = await parseUserIntent(message);
    res.json(result);
  } catch (error) {
    console.error("Error parsing intent:", error);
    res.status(500).json({
      intent: "clarify",
      args: { message: "Error processing request" },
      confidence: 0.0,
      source: "llm",
    });
  }
});

// API endpoint for ChatGPT completion
app.post("/api/chat", async (req, res) => {
  try {
    const { message, code } = req.body;
    
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    // Log the request for debugging
    console.log("[Chat API] Request received:");
    console.log("[Chat API] Message:", message);
    console.log("[Chat API] Code provided:", !!code);
    console.log("[Chat API] Code length:", code?.length || 0);

    // First, check if intent is clear using intent parser
    const intentResult = await parseUserIntent(message);
    
    // If intent is unclear (clarify with low confidence), ask ChatGPT for clarification
    if (intentResult.intent === "clarify" && intentResult.confidence < 0.7) {
      console.log("[Chat API] Intent unclear, asking ChatGPT for clarification");
      
      const clarificationPrompt = `The user's request is unclear: "${message}"

${code ? `Current M code:\n\`\`\`m\n${code}\n\`\`\`\n\n` : ""}Please respond conversationally (like ChatGPT) to ask what they mean. For example:
- "I'm not sure what you'd like me to do. Did you mean to [option 1] or [option 2]?"
- "Could you clarify what you'd like me to do with the data?"
- "I need a bit more information. Are you trying to [option 1] or [option 2]?"

Do NOT generate any M code. Just ask for clarification in a friendly, conversational way.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a helpful assistant that asks clarifying questions when user requests are unclear." },
          { role: "user", content: clarificationPrompt },
        ],
        temperature: 0.7,
        max_tokens: 200,
      });

      const clarification = response.choices[0]?.message?.content || "I'm not sure what you'd like me to do. Could you clarify?";
      
      // Return clarification message (no code)
      return res.json({ message: clarification });
    }

    // Intent is clear - proceed with code generation
    const systemPrompt = CHAT_SYSTEM_PROMPT;

    const userPrompt = code 
      ? `Current M code:\n\`\`\`m\n${code}\n\`\`\`\n\nUser request: ${message}\n\nAnalyze the current M code to understand the step structure. ALWAYS ADD a new transformation step to fulfill the request. If the user says "add [column] back", add a new step that creates that column with null/empty values. Return the complete updated M code with all previous steps plus the new step.`
      : `User request: ${message}\n\nProvide the complete M code:`;

    console.log("[Chat API] Calling OpenAI for code generation...");
    const startTime = Date.now();
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // TODO: Update to "gpt-5" when available
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });
    
    const elapsed = Date.now() - startTime;
    console.log(`[Chat API] OpenAI response received in ${elapsed}ms`);

    const content = response.choices[0]?.message?.content || "";
    
    // Extract code from markdown code blocks if present
    let codeResult = content.trim();
    const codeBlockMatch = content.match(/```(?:m|powerquery)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      codeResult = codeBlockMatch[1].trim();
    }

    res.json({ code: codeResult });
  } catch (error) {
    console.error("Error in chat completion:", error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Error processing chat request" 
    });
  }
});

// Serve index.html for all routes (SPA)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📝 GUI available at http://localhost:${PORT}`);
  console.log(`🔌 API endpoint: http://localhost:${PORT}/api/parse`);
  console.log(`💬 Chat API endpoint: http://localhost:${PORT}/api/chat`);
});
