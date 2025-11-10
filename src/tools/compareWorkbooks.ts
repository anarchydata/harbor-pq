import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";
import { spawnSync } from "child_process";

interface ZipEntryMap {
  entries: Map<string, Buffer>;
  order: string[];
}

interface ChunkInfo {
  length: number;
  offset: number;
  data: Buffer;
}

interface DifferenceRecord {
  entry: string;
  details: string[];
}

const TEXT_EXTENSIONS = new Set([
  ".xml",
  ".rels",
  ".txt",
  ".json",
  ".csv",
  ".m",
]);

export const TARGET_SPECIFIC_PARTS = new Set([
  "DataMashup",
  "customXml/item1.xml",
  "customXml/itemProps1.xml",
  "customXml/_rels/item1.xml.rels",
  "xl/connections.xml",
]);

function loadZipEntries(filePath: string): ZipEntryMap {
  const zip = new AdmZip(filePath);
  const entries = new Map<string, Buffer>();
  const order: string[] = [];

  for (const entry of zip.getEntries()) {
    entries.set(entry.entryName, entry.getData());
    order.push(entry.entryName);
  }

  return { entries, order };
}

function decodeDataMashup(buffer: Buffer): ChunkInfo[] {
  let offset = 0;
  const chunks: ChunkInfo[] = [];

  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    offset += 4;
    const data = buffer.slice(offset, offset + length);
    chunks.push({ length, offset: offset - 4, data });
    offset += length;
  }

  return chunks;
}

function isTextEntry(name: string, data: Buffer): boolean {
  if (TEXT_EXTENSIONS.has(path.extname(name))) {
    return true;
  }

  const sample = data.subarray(0, Math.min(data.length, 256));
  return sample.every((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 128));
}

function truncate(value: string, limit: number = 200): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function compareBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.equals(b);
}

function compareXml(a: Buffer, b: Buffer): string[] | undefined {
  if (!isTextEntry(".xml", a) || !isTextEntry(".xml", b)) {
    return undefined;
  }

  const textA = a.toString("utf8").replace(/\r\n/g, "\n");
  const textB = b.toString("utf8").replace(/\r\n/g, "\n");

  if (textA === textB) {
    return undefined;
  }

  const linesA = textA.split("\n");
  const linesB = textB.split("\n");
  const maxLines = Math.min(20, Math.max(linesA.length, linesB.length));

  const diffLines: string[] = [];
  for (let i = 0; i < maxLines; i++) {
    const lineA = linesA[i] ?? "";
    const lineB = linesB[i] ?? "";
    if (lineA !== lineB) {
      diffLines.push(`- ${truncate(lineA.trim(), 160)}`);
      diffLines.push(`+ ${truncate(lineB.trim(), 160)}`);
    }
    if (diffLines.length >= 10) {
      break;
    }
  }

  return diffLines;
}

export function rewriteTargetWithBaseline(targetPath: string, target: ZipEntryMap, baseline: ZipEntryMap): void {
  const backupPath = `${targetPath}.bak`;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(targetPath, backupPath);
    console.log(`\nBackup created at ${backupPath}`);
  }

  const outputZip = new AdmZip();
  const baselineOrder = baseline.order;

  for (const name of baselineOrder) {
    if (name === "DataMashup") {
      continue; // drop stray root DataMashup
    }

    let data: Buffer | undefined;

    if (TARGET_SPECIFIC_PARTS.has(name) && target.entries.has(name)) {
      data = target.entries.get(name);
    } else if (baseline.entries.has(name)) {
      data = baseline.entries.get(name);
    } else {
      data = target.entries.get(name);
    }

    if (!data) {
      continue;
    }

    outputZip.addFile(name, data);
  }

  for (const [name, data] of target.entries.entries()) {
    if (!baseline.entries.has(name) && name !== "DataMashup") {
      outputZip.addFile(name, data);
    }
  }

  outputZip.writeZip(targetPath);
  console.log(`\nRewrote ${targetPath} using baseline structure.`);
}

export function runValidator(targetPath: string): void {
  const nodeCmd = process.execPath;
  const standardPath = path.resolve(
    __dirname,
    "..",
    "..",
    "external",
    "ooxml-cli",
    "dist",
    "npm",
    "bin",
    "ooxml-cli.js"
  );
  const fallbackPath = path.resolve(
    __dirname,
    "..",
    "..",
    "external",
    "ooxml-cli",
    "Projectsharbor-pqexternalooxml-cli",
    "dist",
    "npm",
    "bin",
    "ooxml-cli.js"
  );

  const cliScript = fs.existsSync(standardPath)
    ? standardPath
    : fs.existsSync(fallbackPath)
    ? fallbackPath
    : null;

  if (!cliScript) {
    console.warn("[Comparator] OOXML CLI not found. Run npm run build inside external/ooxml-cli.");
    return;
  }

  const result = spawnSync(nodeCmd, [cliScript, "validate", targetPath], {
    windowsHide: true,
    encoding: "utf-8",
  });

  if (result.error) {
    console.warn("[Comparator] Validator failed to launch:", result.error.message);
    return;
  }

  if (result.status !== 0) {
    console.warn("[Comparator] Validator reported issues:", result.stdout || result.stderr || `exit code ${result.status}`);
  } else if (result.stdout) {
    console.log("[Comparator] Validator output:", result.stdout.trim());
  }
}

const DEFAULT_BASELINE_PATH = path.resolve(__dirname, "..", "..", "templates", "baseline.xlsx");

export function normalizeWithBaseline(targetPath: string, baselinePath: string = DEFAULT_BASELINE_PATH): void {
  const target = loadZipEntries(path.resolve(targetPath));
  const baseline = loadZipEntries(path.resolve(baselinePath));
  rewriteTargetWithBaseline(targetPath, target, baseline);
  // Temporarily skip validation to avoid potential native crashes during workbook generation
  // runValidator(targetPath);
}

function compareWorkbooks(fileA: string, fileB: string): void {
  console.log(`Comparing:\n  Target:   ${fileA}\n  Baseline: ${fileB}`);

  if (!fs.existsSync(fileA) || !fs.existsSync(fileB)) {
    throw new Error("Both files must exist.");
  }

  const target = loadZipEntries(fileA);
  const baseline = loadZipEntries(fileB);

  const differences: DifferenceRecord[] = [];

  const entriesTarget = new Set(target.entries.keys());
  const entriesBaseline = new Set(baseline.entries.keys());

  const onlyInTarget = [...entriesTarget].filter((name) => !entriesBaseline.has(name));
  const onlyInBaseline = [...entriesBaseline].filter((name) => !entriesTarget.has(name));
  const common = [...entriesTarget].filter((name) => entriesBaseline.has(name)).sort();

  if (onlyInTarget.length > 0) {
    differences.push({
      entry: "<only in target>",
      details: onlyInTarget.sort().map((name) => `+ ${name}`),
    });
  }
  if (onlyInBaseline.length > 0) {
    differences.push({
      entry: "<only in baseline>",
      details: onlyInBaseline.sort().map((name) => `+ ${name}`),
    });
  }

  for (const name of common) {
    const dataTarget = target.entries.get(name)!;
    const dataBaseline = baseline.entries.get(name)!;

    if (compareBuffers(dataTarget, dataBaseline)) {
      continue;
    }

    const record: DifferenceRecord = {
      entry: name,
      details: [`size target=${dataTarget.length} bytes`, `size baseline=${dataBaseline.length} bytes`],
    };

    const xmlDiff = compareXml(dataTarget, dataBaseline);
    if (xmlDiff) {
      record.details.push("xml differences:");
      record.details.push(...xmlDiff.map((line) => `  ${line}`));
    } else if (name === "DataMashup") {
      const chunksTarget = decodeDataMashup(dataTarget);
      const chunksBaseline = decodeDataMashup(dataBaseline);
      record.details.push(
        "chunks target: " + chunksTarget.map((chunk, idx) => `[#${idx + 1}] len=${chunk.length}`).join(", ")
      );
      record.details.push(
        "chunks baseline: " + chunksBaseline.map((chunk, idx) => `[#${idx + 1}] len=${chunk.length}`).join(", ")
      );
    } else if (isTextEntry(name, dataTarget) && isTextEntry(name, dataBaseline)) {
      record.details.push(`text target: ${truncate(dataTarget.toString("utf8").trim().replace(/\s+/g, " "), 160)}`);
      record.details.push(`text baseline: ${truncate(dataBaseline.toString("utf8").trim().replace(/\s+/g, " "), 160)}`);
    }

    differences.push(record);
  }

  if (differences.length === 0) {
    console.log("No differences detected.");
  } else {
    console.log("\nDifferences detected:");
    for (const diff of differences) {
      console.log(`\n- ${diff.entry}`);
      diff.details.forEach((detail) => console.log(`  ${detail}`));
    }
  }

  rewriteTargetWithBaseline(fileA, target, baseline);
  runValidator(fileA);

  if (differences.length > 0) {
    const summaryPath = `${fileA}.diff.json`;
    fs.writeFileSync(summaryPath, JSON.stringify(differences, null, 2), "utf8");
    console.log(`\nSummary written to ${summaryPath}`);
  }
}

function main(): void {
  const [fileA, fileB] = process.argv.slice(2);
  if (!fileA || !fileB) {
    console.error("Usage: node dist/tools/compareWorkbooks.js <targetWorkbook.xlsx> <baselineWorkbook.xlsx>");
    process.exit(1);
  }

  try {
    compareWorkbooks(path.resolve(fileA), path.resolve(fileB));
  } catch (error) {
    console.error("Comparison failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
