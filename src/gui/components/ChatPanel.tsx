/**
 * Chat/assistant panel with intent strip and composer
 */

import React, { useState, useRef, useEffect } from "react";
import { IntentResult } from "../../intentTypes";
import "./ChatPanel.css";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  intent?: IntentResult;
  mCode?: string; // M code being executed
  status?: "running" | "completed" | "error"; // Execution status
  actionDescription?: string; // What the AI is doing (e.g., "Adding filtering step...")
}

interface ChatPanelProps {
  onSendMessage?: (message: string) => void;
  onCodeUpdate?: (code: string) => void;
  intentResult?: IntentResult | null;
  currentCode?: string;
  isExecuting?: boolean;
  executingMCode?: string; // Still receive it but don't use it for display
}

export function ChatPanel({ onSendMessage, onCodeUpdate, intentResult, currentCode = "", isExecuting = false, executingMCode }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const executionMessageIdRef = useRef<string | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle execution status changes
  // Only show execution messages in chat if execution is from chat (not from step clicks or Excel imports)
  useEffect(() => {
    // Check if this execution is from chat - we'll use a prop for this
    // For now, only show chat messages if executingMCode is set (which only happens from chat)
    if (isExecuting && executingMCode) {
      // Add or update execution message
      // Use currentCode (same as editor) instead of executingMCode for display
      const executionMessage: Message = {
        id: executionMessageIdRef.current || Date.now().toString(),
        role: "assistant",
        content: "Running...",
        timestamp: new Date(),
        mCode: currentCode, // Use currentCode (same as editor) so chat and editor match
        status: "running",
        actionDescription: "Executing M code...",
      };
      
      if (!executionMessageIdRef.current) {
        // First time - add new message
        executionMessageIdRef.current = executionMessage.id;
        setMessages((prev) => [...prev, executionMessage]);
      } else {
        // Update existing message
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === executionMessageIdRef.current
              ? { ...executionMessage, actionDescription: msg.actionDescription || "Executing M code..." }
              : msg
          )
        );
      }
    } else if (!isExecuting && executionMessageIdRef.current) {
      // Execution finished - KEEP the message with mCode, just mark as completed
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === executionMessageIdRef.current
            ? { ...msg, status: "completed" as const }
            : msg
        )
      );
      // Don't clear the ref - keep the message visible
      setTimeout(() => {
        executionMessageIdRef.current = null;
      }, 2000);
    }
  }, [isExecuting, executingMCode, currentCode]);

  const handleSend = async () => {
    if (!input.trim() || isComposing || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const messageText = input.trim();
    setInput("");
    setIsLoading(true);
    
    // Show spinner immediately
    const waitingMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: "Running...",
      timestamp: new Date(),
      status: "running",
    };
    setMessages((prev) => [...prev, waitingMessage]);
    
    // Add "add as last step: " prefix if not already present
    const prefix = "add as last step: ";
    const prefixedMessage = messageText.toLowerCase().includes(prefix.toLowerCase())
      ? messageText
      : `${prefix}${messageText}`;
    
    // Parse intent first (use original message for intent parsing)
    onSendMessage?.(messageText);

    // Send to ChatGPT for code completion
    try {
      console.log("[ChatPanel] Original message:", messageText);
      console.log("[ChatPanel] Prefixed message for ChatGPT:", prefixedMessage);
      console.log("[ChatPanel] Current code length:", currentCode?.length || 0);
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
      
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          message: prefixedMessage, // Use prefixed message for ChatGPT
          code: currentCode,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      console.log("[ChatPanel] Response status:", response.status, response.statusText);

      let data;
      try {
        data = await response.json();
        console.log("[ChatPanel] Response data received, has code:", !!data.code, "has error:", !!data.error);
      } catch (e) {
        // If response is not JSON, read as text
        const text = await response.text();
        console.error("[ChatPanel] Failed to parse JSON response:", text);
        throw new Error(`Server error (${response.status}): ${text || "Unknown error"}`);
      }
      
      if (!response.ok) {
        console.error("[ChatPanel] Response not OK:", response.status, data);
        throw new Error(data.error || `Failed to get response from ChatGPT (${response.status})`);
      }
      
      if (data.error) {
        console.error("[ChatPanel] Error in response data:", data.error);
        throw new Error(data.error);
      }

      // Update code if we got a code response
      if (data.code) {
        console.log("[ChatPanel] Code received from OpenAI, length:", data.code.length);
        
        // Add assistant message describing what was done
        const actionDesc = messageText.toLowerCase().includes("remove") 
          ? "Adding filtering step to remove rows..."
          : messageText.toLowerCase().includes("add") || messageText.toLowerCase().includes("create")
          ? "Adding transformation step..."
          : "Applying transformation...";
        
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: actionDesc,
          timestamp: new Date(),
          status: "completed",
        };
        setMessages((prev) => [...prev, assistantMessage]);
        
        // Step 4: Replace Source with #table (if needed) before passing to onCodeUpdate
        // onCodeUpdate will handle the replacement and execution
        const sendLog = (level: "log" | "warn" | "error" | "info", message: string) => {
          if (window.electronAPI?.sendLog) {
            window.electronAPI.sendLog(level, message);
          }
        };
        
        sendLog("log", "=".repeat(80));
        sendLog("log", "[ChatPanel] CODE RECEIVED FROM OPENAI");
        sendLog("log", `[ChatPanel] Code length: ${data.code.length}`);
        sendLog("log", `[ChatPanel] Code first 200 chars: ${data.code.substring(0, 200)}`);
        sendLog("log", `[ChatPanel] Code last 200 chars: ${data.code.substring(Math.max(0, data.code.length - 200))}`);
        sendLog("log", `[ChatPanel] FULL CODE FROM OPENAI: ${data.code}`);
        sendLog("log", "=".repeat(80));
        
        // Check if code is complete
        const hasIn = /\bin\s+/.test(data.code);
        if (!hasIn) {
          sendLog("error", "=".repeat(80));
          sendLog("error", "[ChatPanel] ERROR: Code from OpenAI is MISSING 'in' statement!");
          sendLog("error", `[ChatPanel] Code length: ${data.code.length}`);
          sendLog("error", `[ChatPanel] Last 200 chars: ${data.code.substring(Math.max(0, data.code.length - 200))}`);
          sendLog("error", `[ChatPanel] FULL CODE: ${data.code}`);
          sendLog("error", "=".repeat(80));
        } else {
          const inMatch = data.code.match(/\bin\s+([^\s]+)/);
          sendLog("log", `[ChatPanel] ✓ Code has "in" statement, final step: ${inMatch ? inMatch[1] : "unknown"}`);
        }
        
        // Send EXACT code from OpenAI - no modifications
        sendLog("log", `[ChatPanel] Sending code to onCodeUpdate - EXACT from OpenAI, length: ${data.code.length}`);
        sendLog("log", `[ChatPanel] Full code being sent: ${data.code}`);
        onCodeUpdate?.(data.code);
      } else if (data.message) {
        // Clarification message from ChatGPT (no code to execute)
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.message,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        // Fallback message
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "I've processed your request.",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error("[ChatPanel] Error in handleSend:", error);
      console.error("[ChatPanel] Error stack:", error instanceof Error ? error.stack : "No stack trace");
      
      let errorMessage = "Error processing request";
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          errorMessage = "Request timed out. Please try again.";
        } else {
          errorMessage = error.message;
        }
      }
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
        status: "error",
      };
      setMessages((prev) => [...prev, assistantMessage]);
      // Pass error to parent for status bar display
      onSendMessage?.(`error:${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape") {
      inputRef.current?.blur();
    }
  };


  const getIntentColor = (intent?: IntentResult) => {
    if (!intent) return "transparent";
    if (intent.intent === "clarify") return "var(--error)";
    if (intent.source === "rule") return "var(--success)";
    return "var(--accent)";
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h2>Assistant — GPT-5</h2>
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>Start a conversation with the assistant</p>
            <p className="chat-empty-hint">
              Ask questions or give commands to modify your M code
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`chat-message chat-message-${message.role} ${message.role === "assistant" ? "chat-message-assistant-plain" : ""}`}
            >
              {message.role === "user" ? (
                // User messages have bubbles
                <>
                  <div className="chat-message-content">
                    {message.content}
                  </div>
                  <div className="chat-message-time">
                    {message.timestamp.toLocaleTimeString()}
                  </div>
                </>
              ) : (
                // Assistant messages are plain text (like Cursor)
                <>
                  {message.mCode && (
                    <pre className="chat-message-code">
                      <code>{message.mCode}</code>
                    </pre>
                  )}
                  <div className="chat-message-status">
                    {message.status === "running" && (
                      <div className="chat-status-running">
                        <div className="spinner-ring-small"></div>
                        <span className="thinking-text">{message.content}</span>
                      </div>
                    )}
                    {message.status !== "running" && (message.actionDescription || message.content) && (
                      <span className="chat-action-description">{message.actionDescription || message.content}</span>
                    )}
                  </div>
                  {message.status === "completed" && (
                    <div className="chat-message-status-completed">✓ Completed</div>
                  )}
                </>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>



      <div className="chat-composer">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          rows={3}
        />
        <button
          className="chat-send-button"
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          title="Send (Ctrl+Enter)"
        >
          {isLoading ? "⏳" : "→"}
        </button>
      </div>
    </div>
  );
}

