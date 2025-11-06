/**
 * M-code editor with syntax highlighting and code tracking
 */

import React, { useState, useRef, useEffect } from "react";
import "./MCodeEditor.css";

interface MCodeEditorProps {
  code?: string;
  onCodeChange?: (code: string) => void;
  highlightedLines?: number[]; // Line numbers to highlight (1-based)
}

// Clean text - aggressively remove any HTML or markup
function cleanCodeText(text: string): string {
  if (!text) return "";
  
  // CRITICAL: This function must NEVER allow HTML to pass through
  // Multiple passes ensure we catch all variations
  
  // Pass 0: Remove mcode- patterns FIRST (before removing all HTML tags)
  // This catches <mcode-keyword>, "mcode-keyword">, "mcode-k (partial), etc. BEFORE they get processed
  let cleaned = text.replace(/<mcode-[a-zA-Z0-9-]+>/g, ''); // Match <mcode-xxx>
  cleaned = cleaned.replace(/["'`]?mcode-[a-zA-Z0-9-]+["'`]?">?/g, ''); // Match "mcode-xxx">
  cleaned = cleaned.replace(/["'`][`']?mcode-[a-zA-Z0-9-]+["'`]?[`']?["'`]?">?/g, '');
  cleaned = cleaned.replace(/mcode-[a-zA-Z0-9-]+["'`]+">?/g, '');
  cleaned = cleaned.replace(/[`"'`]+mcode-[a-zA-Z0-9-]+[`"'`]+[>]/g, '');
  cleaned = cleaned.replace(/["'`][^"'`]*mcode-[^"'`]*["'`]?[>]/g, '');
  // Catch partial patterns like "mcode-k (incomplete)
  cleaned = cleaned.replace(/["'`]mcode-[a-zA-Z0-9-]*/g, ''); // Remove "mcode-xxx (even if incomplete)
  cleaned = cleaned.replace(/mcode-[a-zA-Z0-9-]*["'`]/g, ''); // Remove mcode-xxx"
  
  // Pass 1: Remove complete HTML tags (this should catch any remaining)
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  
  // Pass 2: Remove any remaining mcode- patterns that survived
  cleaned = cleaned.replace(/["'`]+">/g, '');
  cleaned = cleaned.replace(/`+">/g, '');
  cleaned = cleaned.replace(/<[^>]*mcode-[^>]*>/g, ''); // Match any angle bracket with mcode-
  cleaned = cleaned.replace(/\bmcode-[a-zA-Z0-9-]+\b/g, ''); // Remove standalone mcode- words
  
  // Pass 4: Remove span tags (opening and closing)
  cleaned = cleaned.replace(/<span[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\/span>/gi, '');
  
  // Pass 5: Remove class attributes (even standalone)
  cleaned = cleaned.replace(/class\s*=\s*"[^"]*"/gi, '');
  cleaned = cleaned.replace(/class\s*=\s*'[^']*'/gi, '');
  
  // Pass 6: Remove any remaining HTML entities
  cleaned = cleaned.replace(/&amp;/g, '&');
  cleaned = cleaned.replace(/&lt;/g, '<');
  cleaned = cleaned.replace(/&gt;/g, '>');
  cleaned = cleaned.replace(/&quot;/g, '"');
  cleaned = cleaned.replace(/&nbsp;/g, ' ');
  cleaned = cleaned.replace(/&#39;/g, "'");
  cleaned = cleaned.replace(/&#x27;/g, "'");
  
  // Pass 7: Remove any lingering mcode- patterns (with quotes, backticks, or both)
  cleaned = cleaned.replace(/["'`]?mcode-[a-zA-Z0-9-]*["'`]?[>]/g, '');
  
  // Pass 8: Remove patterns with backticks and quotes specifically
  cleaned = cleaned.replace(/`["']?mcode-[a-zA-Z0-9-]+["']?`[>]/g, '');
  
  // Pass 8: Final safety check - remove any remaining incomplete HTML tags
  // But DON'T remove standalone > characters (they might be valid in M code)
  // CRITICAL: Don't remove incomplete tags at end - this can truncate valid M code!
  // Only remove incomplete tags if they're clearly HTML (contain common HTML tag names)
  // cleaned = cleaned.replace(/<[^>]*$/g, ''); // DISABLED - was truncating code
  
  return cleaned;
}

// Syntax highlighting for M code - works only on raw text, never on HTML
function highlightMCode(text: string): string {
  if (!text) return "";
  
  // First, aggressively clean the text to remove any HTML
  const cleanText = cleanCodeText(text);
  
  // Escape HTML properly
  let highlighted = cleanText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Step names (identifiers followed by =) - must be on their own line or after whitespace
  // Match: whitespace or start of line, then identifier, then = (not part of other patterns)
  highlighted = highlighted.replace(/(^|\s)([a-zA-Z_#][a-zA-Z0-9_#]*)\s*=/gm, (match, prefix, identifier) => {
    // Skip common HTML/reserved words that shouldn't be step names
    if (identifier === 'class' || identifier === 'span' || identifier === 'div' || 
        identifier === 'style' || identifier === 'id' || identifier.startsWith('mcode-')) {
      return match;
    }
    return `${prefix}<span class="mcode-step">${identifier}</span> =`;
  });

  // Keywords (must be whole words)
  const keywords = /\b(let|in|each|if|then|else|as|type|nullable|meta|try|otherwise|error|null|true|false)\b/g;
  highlighted = highlighted.replace(keywords, '<span class="mcode-keyword">$&</span>');

  // Functions and table operations (must be whole words)
  const functions = /\b(Table\.\w+|#table|#date|#time|#datetime|#duration|#text|#binary|#logical|#number)\b/g;
  highlighted = highlighted.replace(functions, '<span class="mcode-function">$&</span>');

  // Strings (double quotes) - BUT SKIP if it contains mcode- (that's HTML leakage, not a real string)
  highlighted = highlighted.replace(/"([^"]*)"/g, (match, content) => {
    // Skip if this looks like HTML leakage
    if (content.includes('mcode-')) {
      // Return just the content without quotes (clean it)
      return cleanCodeText(content);
    }
    return `<span class="mcode-string">"${content}"</span>`;
  });

  // Numbers (must be whole words, not part of identifiers)
  highlighted = highlighted.replace(/\b(\d+\.?\d*)\b/g, '<span class="mcode-number">$1</span>');

  // Comments (// at start of line or after whitespace)
  highlighted = highlighted.replace(/(^|\s)(\/\/.*)$/gm, '$1<span class="mcode-comment">$2</span>');

  return highlighted;
}

export function MCodeEditor({
  code = "",
  onCodeChange,
  highlightedLines = [],
}: MCodeEditorProps) {
  // CRITICAL: Clean the initial code immediately to prevent HTML leakage
  const initialCleanCode = cleanCodeText(code || "");
  const [content, setContent] = useState(initialCleanCode);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  const [highlightedCode, setHighlightedCode] = useState(() => {
    // Initialize with highlighted version of initial code
    if (!initialCleanCode) return "";
    return highlightMCode(initialCleanCode);
  });
  const [newCodeLines, setNewCodeLines] = useState<number[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const codeDisplayRef = useRef<HTMLDivElement>(null);
  const lastExternalCodeRef = useRef<string>(code);
  const lastCleanedCodeRef = useRef<string>(initialCleanCode);
  const previousCodeLinesRef = useRef<number>(initialCleanCode ? initialCleanCode.split("\n").length : 0);

  useEffect(() => {
    // Only update content when code prop changes from external source
    // CRITICAL: Don't update if the code hasn't actually changed (prevents disappearing)
    const currentCode = code || "";
    const lastCode = lastExternalCodeRef.current || "";
    
    // Only proceed if code actually changed
    if (currentCode !== lastCode) {
      // Clean the incoming code first
      const cleanCode = cleanCodeText(currentCode);
      
      // CRITICAL: Only update if cleaned code is different from last cleaned code
      // This prevents clearing the editor when code prop is empty or the same
      const lastCleaned = lastCleanedCodeRef.current || "";
      
      // If cleaned code is different from last cleaned (or is first time), update
      // Always use the exact code from props - don't skip if it matches lastCleaned
      // This ensures we always display the exact code from chat without truncation
      if (cleanCode !== lastCleaned || (cleanCode.length > 0 && lastCleaned.length === 0)) {
        const oldLines = previousCodeLinesRef.current;
        const newLines = cleanCode.split("\n");
        const newLineCount = newLines.length;
        
        // Detect if new lines were added (only if code is being appended, not replaced)
        if (newLineCount > oldLines && cleanCode.startsWith(lastCleaned) && lastCleaned.length > 0) {
          // Highlight new lines
          const newLineNumbers = [];
          for (let i = oldLines; i < newLineCount; i++) {
            newLineNumbers.push(i);
          }
          setNewCodeLines(newLineNumbers);
          // Clear highlight after 3 seconds
          setTimeout(() => {
            setNewCodeLines([]);
          }, 3000);
        }
        
        // Update refs
        lastExternalCodeRef.current = currentCode;
        lastCleanedCodeRef.current = cleanCode;
        previousCodeLinesRef.current = newLineCount;
        
        // Update content state
        setContent(cleanCode);
        
        // Update highlighted version from clean code
        const highlighted = highlightMCode(cleanCode);
        setHighlightedCode(highlighted);
        
        // Reset cursor position if content changed externally
        if (newLineCount > 0) {
          setCursorPosition({ 
            line: newLineCount, 
            col: (newLines[newLineCount - 1]?.length || 0) + 1 
          });
        }
        
        // Sync scroll position
        if (textareaRef.current && codeDisplayRef.current) {
          codeDisplayRef.current.scrollTop = textareaRef.current.scrollTop;
          codeDisplayRef.current.scrollLeft = textareaRef.current.scrollLeft;
        }
      } else if (cleanCode.length === 0 && lastCleaned.length > 0) {
        // If cleaned code is empty but we had content, don't clear it
        // This prevents the editor from being cleared when code prop becomes empty
        lastExternalCodeRef.current = currentCode;
        // Don't update content or refs - preserve existing content
      } else {
        // Code changed externally but cleaned version matches last cleaned
        // Just update the ref to prevent re-triggering
        lastExternalCodeRef.current = currentCode;
      }
    }
  }, [code]); // Only depend on code prop

  // Safety check: Ensure content never contains HTML (catch any edge cases)
  // Use a ref to track if we're currently cleaning to prevent loops
  const isCleaningRef = useRef(false);
  useEffect(() => {
    if (content && !isCleaningRef.current) {
      const cleaned = cleanCodeText(content);
      if (cleaned !== content) {
        // Content has HTML - clean it immediately
        console.warn("[MCodeEditor] Detected HTML in content, cleaning...");
        isCleaningRef.current = true;
        setContent(cleaned);
        const highlighted = highlightMCode(cleaned);
        setHighlightedCode(highlighted);
        lastCleanedCodeRef.current = cleaned;
        // Reset flag after React updates
        setTimeout(() => {
          isCleaningRef.current = false;
        }, 0);
      }
    }
  }, [content]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    
    // CRITICAL: Ensure content is clean (aggressively remove any HTML that might have leaked in)
    // This is the ONLY place where textarea value should be set - it must ALWAYS be clean
    const cleanContent = cleanCodeText(newContent);
    
    // Update the cleaned code ref to keep it in sync
    lastCleanedCodeRef.current = cleanContent;
    
    // If cleaning changed the content, we need to update the textarea
    // But we need to preserve cursor position
    if (cleanContent !== newContent) {
      const textarea = e.target;
      const cursorPos = textarea.selectionStart;
      const scrollPos = textarea.scrollTop;
      
      // Set clean content
      setContent(cleanContent);
      
      // Restore cursor position after a brief delay to let React update
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(cursorPos, cursorPos);
          textareaRef.current.scrollTop = scrollPos;
        }
      }, 0);
    } else {
      setContent(cleanContent);
    }
    
    const newLines = cleanContent.split("\n");
    previousCodeLinesRef.current = newLines.length;
    
    // Update highlighted version from clean content
    const highlighted = highlightMCode(cleanContent);
    setHighlightedCode(highlighted);
    
    // Always pass clean content to parent
    onCodeChange?.(cleanContent);

    // Update cursor position
    const textarea = e.target;
    const lines = cleanContent.substring(0, Math.min(textarea.selectionStart, cleanContent.length)).split("\n");
    setCursorPosition({
      line: lines.length,
      col: lines[lines.length - 1] ? lines[lines.length - 1].length + 1 : 1,
    });
  };

  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current && codeDisplayRef.current) {
      const scrollTop = textareaRef.current.scrollTop;
      const scrollLeft = textareaRef.current.scrollLeft;
      lineNumbersRef.current.scrollTop = scrollTop;
      codeDisplayRef.current.scrollTop = scrollTop;
      codeDisplayRef.current.scrollLeft = scrollLeft;
    }
  };

  const lines = content.split("\n");
  const shouldShowScrollbar = lines.length > 5;

  return (
    <div className="mcode-editor">
      <div className="mcode-editor-container">
        <div className="mcode-gutter" ref={lineNumbersRef}>
          {lines.map((_, lineIdx) => {
            const lineNum = lineIdx + 1;
            return (
              <div key={lineIdx} className="mcode-gutter-line">
                <span className="mcode-line-number">{lineNum}</span>
              </div>
            );
          })}
        </div>

        <div className="mcode-editor-wrapper">
          {/* Syntax-highlighted overlay - always visible */}
          <div
            ref={codeDisplayRef}
            className="mcode-display"
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
          
          {/* Transparent textarea for input */}
          <textarea
            ref={textareaRef}
            className="mcode-textarea"
            value={cleanCodeText(content)} // CRITICAL: Always clean on render to prevent any HTML
            onChange={handleChange}
            onScroll={handleScroll}
            onPaste={(e) => {
              // Intercept paste and clean the pasted content
              e.preventDefault();
              const pastedText = e.clipboardData.getData('text/plain');
              const cleaned = cleanCodeText(pastedText);
              const textarea = e.target as HTMLTextAreaElement;
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              const newContent = content.substring(0, start) + cleaned + content.substring(end);
              const cleanNewContent = cleanCodeText(newContent);
              setContent(cleanNewContent);
              const highlighted = highlightMCode(cleanNewContent);
              setHighlightedCode(highlighted);
              onCodeChange?.(cleanNewContent);
              setTimeout(() => {
                textarea.setSelectionRange(start + cleaned.length, start + cleaned.length);
              }, 0);
            }}
            spellCheck={false}
            wrap="off"
            style={{
              color: "transparent",
              caretColor: "var(--vscode-editor-foreground, #d4d4d4)",
            }}
          />
          
          {/* Highlight overlay for new code lines */}
          {newCodeLines.map((lineNum) => {
            // Account for padding (--spacing-md = 12px) and line height (20px)
            const topOffset = 12 + (lineNum - 1) * 20; // padding-top + (lineNum - 1) * line-height
            return (
              <div
                key={`new-${lineNum}`}
                className="mcode-highlight-new"
                style={{
                  top: `${topOffset}px`,
                  height: "20px",
                }}
              />
            );
          })}
          
          {/* Red highlight overlay for selected step lines */}
          {highlightedLines.map((lineNum) => {
            // Account for padding (--spacing-md = 12px) and line height (20px)
            const topOffset = 12 + (lineNum - 1) * 20; // padding-top + (lineNum - 1) * line-height
            return (
              <div
                key={`highlight-${lineNum}`}
                className="mcode-highlight-step"
                style={{
                  top: `${topOffset}px`,
                  height: "20px",
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
