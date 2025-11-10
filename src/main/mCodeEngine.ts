interface TableData {
  columns: string[];
  rows: any[][];
}

const DEFAULT_RESULT: TableData = {
  columns: ["Column1"],
  rows: [],
};

const DATE_REGEX = /^#date\(\s*(\d{1,4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)$/i;
const DATETIME_REGEX =
  /^#datetime\(\s*(\d{1,4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*\)$/i;

/**
 * Lightweight fallback M-code executor.
 * Attempts to parse simple `#table` literals so the UI can stay responsive
 * even when the primary engine path fails.
 */
export function executeMCode(code: string, initialData?: TableData): TableData {
  if (initialData && initialData.columns?.length) {
    return initialData;
  }

  const parsed = parseMTableLiteral(code);
  if (parsed) {
    return parsed;
  }

  return DEFAULT_RESULT;
}

function parseMTableLiteral(mCode: string): TableData | null {
  const tableMatch = mCode.match(/#table\s*\(\s*\{([\s\S]*?)\}\s*,\s*\{([\s\S]*?)\}\s*\)/i);
  if (!tableMatch) {
    return null;
  }

  const [, columnSection, rowSection] = tableMatch;
  const columns = extractQuotedValues(columnSection).map(unescapeQuotes);
  const rowMatches = Array.from(rowSection.matchAll(/\{([\s\S]*?)\}/g));

  const rows = rowMatches.map((match) =>
    splitTopLevel(match[1]).map((token) => convertValue(token.trim()))
  );

  return {
    columns,
    rows,
  };
}

function extractQuotedValues(section: string): string[] {
  const results: string[] = [];
  const regex = /"([^"]*(?:""[^"]*)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(section))) {
    results.push(match[1]);
  }
  return results;
}

function unescapeQuotes(value: string): string {
  return value.replace(/""/g, '"');
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '{') {
      depth += 1;
      current += char;
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
      current += char;
    } else if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function convertValue(token: string): any {
  if (!token || token.toLowerCase() === "null") {
    return null;
  }

  if (/^"(.*)"$/.test(token)) {
    return unescapeQuotes(token.slice(1, -1));
  }

  if (token === "true" || token === "false") {
    return token === "true";
  }

  const dateMatch = token.match(DATE_REGEX);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  }

  const datetimeMatch = token.match(DATETIME_REGEX);
  if (datetimeMatch) {
    const [, year, month, day, hours, minutes, seconds] = datetimeMatch;
    const sec = Number(seconds);
    const wholeSeconds = Math.trunc(sec);
    const fractional = sec - wholeSeconds;
    const fractionalText = fractional > 0 ? fractional.toFixed(6).substring(1).replace(/0+$/, "") : "";
    return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hours, 2)}:${pad(
      minutes,
      2
    )}:${pad(wholeSeconds, 2)}${fractionalText || ""}`;
  }

  const numeric = Number(token);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  return token;
}

function pad(value: string | number, width: number): string {
  const text = String(value);
  if (text.length >= width) {
    return text;
  }
  return `${"0".repeat(width - text.length)}${text}`;
}


