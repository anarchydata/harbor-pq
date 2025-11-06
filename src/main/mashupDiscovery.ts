/**
 * Discover and cache Microsoft.Mashup.Container.exe location
 */

import * as fs from "fs";
import * as path from "path";

export interface MashupEngineInfo {
  path: string;
  type: "powerbi" | "excel";
  version?: string;
}

let cachedEngine: MashupEngineInfo | null = null;

/**
 * Discover Microsoft.Mashup.Container.exe on the system
 * Searches Power BI Desktop and Excel installation locations
 */
export function discoverMashupEngine(): MashupEngineInfo | null {
  if (cachedEngine && fs.existsSync(cachedEngine.path)) {
    return cachedEngine;
  }

  // Hardcoded path to NetFX45.exe
  const enginePath = "C:\\Program Files\\Microsoft Power BI Desktop\\bin\\Microsoft.Mashup.Container.NetFX45.exe";
  
  if (fs.existsSync(enginePath)) {
    cachedEngine = {
      path: enginePath,
      type: "powerbi",
    };
    console.log(`[MashupDiscovery] ✓ Found Mashup Engine: powerbi at ${enginePath}`);
    try {
      const stats = fs.statSync(enginePath);
      console.log(`[MashupDiscovery] Engine file size: ${stats.size} bytes`);
    } catch (e) {
      console.warn(`[MashupDiscovery] Could not stat engine file:`, e);
    }
    return cachedEngine;
  }

  console.warn(`[MashupDiscovery] ✗ Microsoft.Mashup.Container.NetFX45.exe not found at: ${enginePath}`);
  return null;
}

/**
 * Recursively search directory for a file
 */
function searchDirectory(
  dir: string,
  filename: string,
  type: "powerbi" | "excel",
  results: Array<{ path: string; type: "powerbi" | "excel" }>,
  maxDepth: number = 3,
  currentDepth: number = 0
): void {
  if (currentDepth >= maxDepth) return;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === filename) {
        if (!results.find(r => r.path === fullPath)) {
          results.push({ path: fullPath, type });
        }
      } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
        searchDirectory(fullPath, filename, type, results, maxDepth, currentDepth + 1);
      }
    }
  } catch (error) {
    // Ignore permission errors
  }
}

/**
 * Recursively search directory for files matching a wildcard pattern
 */
function searchDirectoryWildcard(
  dir: string,
  pattern: string, // e.g., "Microsoft.Mashup.Container*.exe"
  type: "powerbi" | "excel",
  results: Array<{ path: string; type: "powerbi" | "excel" }>,
  maxDepth: number = 3,
  currentDepth: number = 0
): void {
  if (currentDepth >= maxDepth) return;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const prefix = pattern.split("*")[0]; // "Microsoft.Mashup.Container"
    const suffix = pattern.split("*")[1]; // ".exe"
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(suffix)) {
        if (!results.find(r => r.path === fullPath)) {
          results.push({ path: fullPath, type });
        }
      } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
        searchDirectoryWildcard(fullPath, pattern, type, results, maxDepth, currentDepth + 1);
      }
    }
  } catch (error) {
    // Ignore permission errors
  }
}

/**
 * Get cached engine info
 */
export function getCachedEngine(): MashupEngineInfo | null {
  return cachedEngine;
}

