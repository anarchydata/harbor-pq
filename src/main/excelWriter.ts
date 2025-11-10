/**
 * Excel Writer - injects Power Query M code into an existing XLSX package.
 *
 * The workbook is assumed to have been created already (e.g. via openpyxl)
 * with a single table (`table1.xml`) that represents the preview data. This
 * module wires that table to a Power Query connection by stamping the
 * DataMashup payload, custom XML metadata, and all required OOXML links.
 */

import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";
import crypto from "crypto";
import { spawnSync } from "child_process";

const normalizeLineEndings = (value: string): string =>
  value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").join("\r\n");

const escapeXmlAttr = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const escapeXmlText = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const newGuid = (): string => `{${crypto.randomUUID().toUpperCase()}}`;

const normalizeMCode = (value: string): string =>
  normalizeLineEndings(value).replace(/\s+$/u, "");

const BASELINE_GUIDS = {
  itemPropsId: "{890A2BE1-0607-4E2A-80A1-A6E3DD19B654}",
  mashupSqmId: "9e308c46-fb1c-4f88-bc69-8c859c398232",
  connectionUid: "{435557DE-A9E1-472E-9CED-43922ADC57DA}",
  tableUid: "{93C3A517-6B98-4E58-BAD7-C376312A0970}",
  autoFilterUid: "{93C3A517-6B98-4E58-BAD7-C376312A0970}",
  queryTableUid: "{48FF3DD1-7251-4652-815E-EE8EB667BCEB}",
};

const BASELINE_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac x16r2 xr" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:x16r2="http://schemas.microsoft.com/office/spreadsheetml/2015/02/main" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision"><fonts count="1" x14ac:knownFonts="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="2"><dxf><numFmt numFmtId="19" formatCode="m/d/yyyy"/></dxf><dxf><numFmt numFmtId="0" formatCode="General"/></dxf></dxfs><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/><extLst><ext uri="{EB79DEF2-80B8-43e5-95BD-54CBDDF9020C}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:slicerStyles defaultSlicerStyle="SlicerStyleLight1"/></ext><ext uri="{9260A510-F301-46a8-8635-F512D64BE5F5}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:timelineStyles defaultTimelineStyle="TimeSlicerStyleLight1"/></ext></extLst></styleSheet>`;

const ZIP_ENTRY_ORDER = [
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/worksheets/sheet1.xml",
  "xl/worksheets/sheet2.xml",
  "xl/theme/theme1.xml",
  "xl/styles.xml",
  "xl/sharedStrings.xml",
  "xl/worksheets/_rels/sheet1.xml.rels",
  "xl/connections.xml",
  "xl/tables/table1.xml",
  "xl/queryTables/queryTable1.xml",
  "customXml/item1.xml",
  "customXml/itemProps1.xml",
  "docProps/core.xml",
  "docProps/app.xml",
  "xl/tables/_rels/table1.xml.rels",
  "customXml/_rels/item1.xml.rels",
];

const ZIP_REORDER_PY = `import json
import sys
import zipfile
import tempfile
from pathlib import Path
import shutil

def main():
    if len(sys.argv) < 3:
        return
    target = Path(sys.argv[1])
    order = json.loads(sys.argv[2])
    if not target.exists():
        return
    with zipfile.ZipFile(target, "r") as src:
        infos = {info.filename: info for info in src.infolist()}
        data = {name: src.read(name) for name in infos}
    tmp_path = target.with_suffix(target.suffix + ".tmp")
    with zipfile.ZipFile(tmp_path, "w") as dst:
        for name in order:
            info = infos.get(name)
            if info:
                dst.writestr(info, data[name])
        for name, info in infos.items():
            if name not in order:
                dst.writestr(info, data[name])
    shutil.move(str(tmp_path), target)

if __name__ == "__main__":
    main()
`;

const enforceZipOrderOnDisk = (zipPath: string): void => {
  const args = ["-c", ZIP_REORDER_PY, zipPath, JSON.stringify(ZIP_ENTRY_ORDER)];
  const result = spawnSync("python", args, { encoding: "utf-8" });
  if (result.status !== 0) {
    const errorOutput = result.stderr || result.stdout || "Unknown Python error";
    throw new Error(`Failed to enforce ZIP order: ${errorOutput}`);
  }
};

type ColumnMetadata = {
  name: string;
  id: number;
  uid: string;
  dataDxfId?: string;
};

const BASELINE_COLUMNS: ColumnMetadata[] = [
  {
    name: "Date",
    id: 1,
    uid: "{5128238D-7AE4-4920-A359-98AFD6A00EAD}",
    dataDxfId: "0",
  },
  {
    name: "Customer",
    id: 2,
    uid: "{81E9934F-77D8-46DB-B780-D8C17A9E1563}",
    dataDxfId: "1",
  },
  {
    name: "SalesAmount",
    id: 4,
    uid: "{49474027-260A-442F-8842-5D390AFC124F}",
  },
];

const PACKAGE_XML =
  '<?xml version="1.0" encoding="utf-8"?><Package xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Version>2.148.201.0</Version><MinVersion>2.21.0.0</MinVersion><Culture>en-US</Culture></Package>';

const PACKAGE_CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="text/xml" /><Default Extension="m" ContentType="application/x-ms-m" /></Types>';

const PERMISSION_LIST_XML =
  '<?xml version="1.0" encoding="utf-8"?><PermissionList xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><CanEvaluateFuturePackages>false</CanEvaluateFuturePackages><FirewallEnabled>true</FirewallEnabled></PermissionList>';

const PERMISSION_BINDINGS = Buffer.from(
  "AQAAANCMnd8BFdERjHoAwE/Cl+sBAAAAy0v697gIqkq4HtWamPDaPAAAAAACAAAAAAAQZgAAAAEAACAAAACpPR0SpsoywCi8+psLhPrzH3dJoxYhviHNCmPiBOSLkwAAAAAOgAAAAAIAACAAAABn3vWb2tvMdRD1cLGlvpzakMLD+/DqpD6fAB42W82+uVAAAACm9OH0xBvjwcipZz2GXRTY+gc80mWkQ+TK3kto9A2ocObTxk9AbIap7hhYfRiBT1ni5FE7jak9dytqwAXQiVDvy6WcEIhahTRUJgXjTKEimEAAAABT4A9h/SlfJWXkPgguVSCiNOT743hoG5nQNLClGfqYiC6+N5fUIWSxuxQEv07oXJd2Cj2g99pwlr4FgJJgWVUc",
  "base64"
);

const EOCD = Buffer.from(
  "UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==",
  "base64"
);

const RELATIONSHIPS_VALUE = "sAAAAAA==";

type PackageEntry = {
  name: string;
  content: Buffer;
};

const packChunk = (payload: Buffer): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
};

const buildPackageZip = (entries: PackageEntry[]): Buffer => {
  const zip = new AdmZip();
  entries.forEach((entry) => {
    zip.addFile(entry.name, entry.content);
  });
  return zip.toBuffer();
};

const sanitizeStepName = (name: string): string => {
  let trimmed = name.trim();
  if (trimmed.startsWith('#"') && trimmed.endsWith('"')) {
    trimmed = trimmed.substring(2, trimmed.length - 1);
  } else if (trimmed.startsWith('#')) {
    trimmed = trimmed.substring(1);
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    trimmed = trimmed.substring(1, trimmed.length - 1);
  }
  return trimmed;
};

const encodeStepPath = (name: string): string =>
  encodeURIComponent(sanitizeStepName(name)).replace(/%2F/g, "/");

interface ExtractedSteps {
  stepNames: string[];
  finalStep: string;
}

const extractQuerySteps = (mCode: string): ExtractedSteps => {
  const letMatch = mCode.match(/\blet\b([\s\S]*?)\bin\b([\s\S]*)/i);
  if (!letMatch) {
    return { stepNames: [], finalStep: mCode.trim() || "Result" };
  }

  const [, letBlock, inBlock] = letMatch;
  const rawSteps = letBlock
    .split(/,\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const stepNames = rawSteps
    .map((line) => {
      const eqIndex = line.indexOf("=");
      return eqIndex === -1 ? line : line.slice(0, eqIndex).trim();
    })
    .filter((name) => name.length > 0);

  const finalExpression = inBlock.trim().replace(/;\s*$/, "");

  return {
    stepNames,
    finalStep: finalExpression,
  };
};

const deriveFillColumnTypes = (mCode: string, columnNames: string[]): string => {
  const typeMap = new Map<string, string>();
  const typeRegex = /\{\"([^\"]+)\"\s*,\s*([^}]+?)\}/g;
  let match: RegExpExecArray | null;
  while ((match = typeRegex.exec(mCode))) {
    const column = match[1];
    const typeToken = match[2].trim().toLowerCase();
    let code = "Q";
    if (typeToken.includes("date")) {
      code = "C";
    } else if (typeToken.includes("int") || typeToken.includes("number") || typeToken.includes("decimal") || typeToken.includes("double") || typeToken.includes("currency")) {
      code = "Y";
    }
    typeMap.set(column, code);
  }

  return columnNames
    .map((name) => typeMap.get(name) ?? "Q")
    .join("");
};

interface LocalMetadataOptions {
  queryName: string;
  tableName: string;
  queryId: string;
  columnNames: string[];
  stepNames: string[];
  finalStep: string;
  fillCount: number;
  mCode: string;
}

const buildLocalMetadataXml = (options: LocalMetadataOptions): string => {
  const {
    queryName,
    tableName,
    queryId,
    columnNames,
    stepNames,
    finalStep,
    fillCount,
    mCode,
  } = options;

  const encodedQueryName = encodeStepPath(queryName);
  const queryPath = `Section1/${encodedQueryName}`;
  const finalStepName = finalStep || (stepNames.length > 0 ? stepNames[stepNames.length - 1] : queryName);
  const encodedFinalStep = encodeStepPath(finalStepName);
  const finalStepPath = `${queryPath}/${encodedFinalStep}`;
  const navigationStep = stepNames.length > 0 ? sanitizeStepName(stepNames[0]) : sanitizeStepName(finalStepName);

  const columnIdentities = columnNames.map((name, index) => `${finalStepPath}.{${name},${index}}`);
  const relationshipInfo = {
    columnCount: columnNames.length,
    keyColumnNames: [] as string[],
    queryRelationships: [] as string[],
    columnIdentities,
    ColumnCount: columnNames.length,
    KeyColumnNames: [] as string[],
    ColumnIdentities: columnIdentities,
    RelationshipInfo: [] as string[],
  };

  const relationshipValue = `s${JSON.stringify(relationshipInfo)}`;
  const columnNamesValue = `s${JSON.stringify(columnNames)}`;
  const fillColumnTypes = `s${deriveFillColumnTypes(mCode, columnNames)}`;
  const fillTargetValue = `s${tableName}`;
  const fillCountValue = `l${Math.max(fillCount, 0)}`;
  const fillLastUpdatedValue = `d${new Date().toISOString()}`;
  const queryIdValue = queryId.startsWith("s") ? queryId : `s${queryId}`;
  const navigationValue = `s${sanitizeStepName(navigationStep)}`;

  const formulaStableEntries = [
    `<Entry Type="IsPrivate" Value="l0" />`,
    `<Entry Type="QueryID" Value="${escapeXmlAttr(queryIdValue)}" />`,
    `<Entry Type="FillEnabled" Value="l1" />`,
    `<Entry Type="FillObjectType" Value="sTable" />`,
    `<Entry Type="FillToDataModelEnabled" Value="l0" />`,
    `<Entry Type="NameUpdatedAfterFill" Value="l0" />`,
    `<Entry Type="ResultType" Value="sTable" />`,
    `<Entry Type="BufferNextRefresh" Value="l1" />`,
    `<Entry Type="FillTarget" Value="${escapeXmlAttr(fillTargetValue)}" />`,
    `<Entry Type="FilledCompleteResultToWorksheet" Value="l1" />`,
    `<Entry Type="FillCount" Value="${escapeXmlAttr(fillCountValue)}" />`,
    `<Entry Type="FillErrorCode" Value="sUnknown" />`,
    `<Entry Type="FillErrorCount" Value="l0" />`,
    `<Entry Type="FillLastUpdated" Value="${escapeXmlAttr(fillLastUpdatedValue)}" />`,
    `<Entry Type="FillColumnTypes" Value="${escapeXmlAttr(fillColumnTypes)}" />`,
    `<Entry Type="FillColumnNames" Value="${escapeXmlAttr(columnNamesValue)}" />`,
    `<Entry Type="FillStatus" Value="sComplete" />`,
    `<Entry Type="NavigationStepName" Value="${escapeXmlAttr(navigationValue)}" />`,
    `<Entry Type="AddedToDataModel" Value="l0" />`,
    `<Entry Type="RelationshipInfoContainer" Value="${escapeXmlAttr(relationshipValue)}" />`,
  ].join("");

  const stepItems = stepNames
    .map((step) => {
      const path = `${queryPath}/${encodeStepPath(step)}`;
      return `<Item><ItemLocation><ItemType>Formula</ItemType><ItemPath>${path}</ItemPath></ItemLocation><StableEntries /></Item>`;
    })
    .join("");

  const itemsXml = [
    `<Item><ItemLocation><ItemType>AllFormulas</ItemType><ItemPath /></ItemLocation><StableEntries><Entry Type="Relationships" Value="${RELATIONSHIPS_VALUE}" /></StableEntries></Item>`,
    `<Item><ItemLocation><ItemType>Formula</ItemType><ItemPath>${queryPath}</ItemPath></ItemLocation><StableEntries>${formulaStableEntries}</StableEntries></Item>`,
    stepItems,
  ].join("");

  return `<?xml version="1.0" encoding="utf-8"?><LocalPackageMetadataFile xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Items>${itemsXml}</Items></LocalPackageMetadataFile>`;
};

const findBaselineColumn = (columnName: string): ColumnMetadata | undefined => {
  const normalized = columnName.trim().toLowerCase();
  return BASELINE_COLUMNS.find((baseline) => baseline.name.toLowerCase() === normalized);
};

const buildColumnMetadata = (columnNames: string[], tableXml: string): ColumnMetadata[] => {
  const matches = Array.from(
    tableXml.matchAll(
      /<tableColumn[^>]*id="([\d]+)"[^>]*queryTableFieldId="([\d]+)"[^>]*xr3:uid="([^"]+)"[^>]*name="([^"]+)"[^>]*?(?:dataDxfId="([^"]+)")?/g
    )
  );

  const metadata: ColumnMetadata[] = columnNames.map((name) => {
    const baseline = findBaselineColumn(name);
    return baseline ? { ...baseline, name } : { name, id: 0, uid: newGuid() };
  });

  const assignFromMatch = (name: string, match: RegExpMatchArray): ColumnMetadata => {
    const id = parseInt(match[1], 10);
    const uid = match[3];
    const dataDxfId = match[5];
    return { name, id, uid, dataDxfId };
  };

  const updated: ColumnMetadata[] = [];

  for (const meta of metadata) {
    const match = matches.find((entry) => entry[4].trim().toLowerCase() === meta.name.trim().toLowerCase());
    if (match) {
      updated.push(assignFromMatch(meta.name, match));
    } else {
      updated.push(meta);
    }
  }

  const usedIds = new Set<number>();
  const usedUids = new Set<string>();

  const ensureUnique = (meta: ColumnMetadata, index: number): ColumnMetadata => {
    let { id, uid, dataDxfId } = meta;
    if (id && !usedIds.has(id)) {
      usedIds.add(id);
    } else {
      let candidate = index + 1;
      while (usedIds.has(candidate)) {
        candidate += 1;
      }
      id = candidate;
      usedIds.add(id);
    }

    if (uid && !usedUids.has(uid)) {
      usedUids.add(uid);
    } else {
      uid = newGuid();
      usedUids.add(uid);
    }

    if (dataDxfId === undefined) {
      dataDxfId = index === 0 ? "0" : index === 1 ? "1" : undefined;
    }

    return { name: meta.name, id, uid, dataDxfId };
  };

  return updated.map((meta, index) => ensureUnique(meta, index));
};

const CUSTOM_XML_REL_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>`;

const CONNECTIONS_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml";
const QUERYTABLE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml";
const CUSTOMXML_PROPS_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.customXmlProperties+xml";

const toUtf8Buffer = (value: string): Buffer => Buffer.from(normalizeLineEndings(value), "utf8");

const toUtf16Buffer = (value: string): Buffer => {
  const normalized = normalizeLineEndings(value);
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(normalized, "utf16le")]);
};

const parseCellReference = (cellRef: string): { column: string; row: number } => {
  const match = cellRef.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) {
    throw new Error(`Invalid cell reference: ${cellRef}`);
  }
  return { column: match[1], row: parseInt(match[2], 10) };
};

const splitTableReference = (ref: string): {
  start: { column: string; row: number };
  end: { column: string; row: number };
} => {
  const parts = ref.split(":");
  const start = parseCellReference(parts[0]);
  const end = parseCellReference(parts[1] ?? parts[0]);
  return { start, end };
};

const formatAbsoluteCell = (cell: { column: string; row: number }): string =>
  `$${cell.column.toUpperCase()}$${cell.row}`;

const quoteSheetName = (name: string): string => {
  if (/^[A-Za-z0-9_]+$/.test(name)) {
    return name;
  }
  const escaped = name.replace(/'/g, "''");
  return `'${escaped}'`;
};

function createDataMashupStream(
  mCode: string,
  options: {
    queryName: string;
    tableName: string;
    columnNames: string[];
    fillCount: number;
  }
): Buffer {
  const { queryName, tableName, columnNames, fillCount } = options;
  const normalizedQueryName = queryName.trim() || "Query1";
  const formattedQueryName = normalizedQueryName.includes(" ")
    ? `#"${normalizedQueryName.replace(/"/g, '""')}"`
    : normalizedQueryName;
  const normalizedM = normalizeLineEndings(mCode);
  const trimmedM = normalizedM.trim();
  const needsWrap = !/^section\b/i.test(trimmedM);
  const body = trimmedM.endsWith(";") || trimmedM.endsWith(";") ? trimmedM : `${trimmedM};`;
  const sectionM = needsWrap
    ? `section Section1;\r\n\r\nshared ${formattedQueryName} = ${body}`
    : normalizedM;

  const packageEntries: PackageEntry[] = [
    {
      name: "Config/Package.xml",
      content: Buffer.from(PACKAGE_XML, "utf-8"),
    },
    {
      name: "[Content_Types].xml",
      content: Buffer.from(PACKAGE_CONTENT_TYPES_XML, "utf-8"),
    },
    {
      name: "Formulas/Section1.m",
      content: Buffer.from(sectionM, "utf-8"),
    },
  ];

  const packageZipBuffer = buildPackageZip(packageEntries);
  const packageChunk = packChunk(packageZipBuffer);

    const permissionsBuffer = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(PERMISSION_LIST_XML, "utf-8"),
    ]);
    const permissionsChunk = packChunk(permissionsBuffer);

  const { stepNames, finalStep } = extractQuerySteps(normalizedM);
  const queryId = `s${crypto.randomUUID()}`;
  const metadataXml = buildLocalMetadataXml({
    queryName: normalizedQueryName,
    tableName,
    queryId,
    columnNames,
    stepNames,
    finalStep,
    fillCount,
    mCode: normalizedM,
  });

  const metadataBuffer = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(metadataXml, "utf-8"),
  ]);

    const localMetaHeader = Buffer.alloc(8);
    localMetaHeader.writeUInt32LE(0, 0);
  localMetaHeader.writeUInt32LE(metadataBuffer.length, 4);
  const eocdLength = Buffer.alloc(4);
  eocdLength.writeUInt32LE(EOCD.length, 0);
  const localMetadataChunk = packChunk(
    Buffer.concat([localMetaHeader, metadataBuffer, eocdLength, EOCD])
  );

    const dataMashup = Buffer.concat([
      packChunk(Buffer.alloc(0)),
      packageChunk,
      permissionsChunk,
      localMetadataChunk,
      packChunk(PERMISSION_BINDINGS),
    ]);

  return dataMashup;
}

const createCustomXmlBuffer = (base64Mashup: string, mashupGuid: string): Buffer => {
  const xml = `<?xml version="1.0" encoding="utf-16"?><DataMashup sqmid="${mashupGuid}" xmlns="http://schemas.microsoft.com/DataMashup">${base64Mashup}</DataMashup>`;
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]);
};

const readXml = (zip: AdmZip, entryName: string): string => {
  const entry = zip.getEntry(entryName);
  if (!entry) {
    throw new Error(`Missing entry: ${entryName}`);
  }
  return entry.getData().toString("utf8");
};

const writeUtf8Entry = (zip: AdmZip, entryName: string, content: string): void => {
  const buffer = toUtf8Buffer(content);
  if (zip.getEntry(entryName)) {
    zip.updateFile(entryName, buffer);
  } else {
    zip.addFile(entryName, buffer);
  }
};

const writeUtf16Entry = (zip: AdmZip, entryName: string, buffer: Buffer): void => {
  if (zip.getEntry(entryName)) {
    zip.updateFile(entryName, buffer);
  } else {
    zip.addFile(entryName, buffer);
  }
};

const removeEntryIfExists = (zip: AdmZip, entryName: string): void => {
  if (zip.getEntry(entryName)) {
    zip.deleteFile(entryName);
  }
};

const parseTableColumns = (tableXml: string): string[] => {
  const matches = Array.from(tableXml.matchAll(/<tableColumn[^>]*name="([^"]+)"/g));
  return matches.map((match) => match[1]);
};

const updateContentTypes = (original: string): string => {
  const defaults: Array<{ extension: string; contentType: string }> = [];
  const overrides: Array<{ partName: string; contentType: string }> = [];

  original.replace(
    /<Default Extension="([^"]+)" ContentType="([^"]+)" ?\/>/g,
    (_, ext, contentType) => {
      defaults.push({ extension: ext, contentType });
      return "";
    }
  );

  original.replace(
    /<Override PartName="([^"]+)" ContentType="([^"]+)" ?\/>/g,
    (_, partName, contentType) => {
      overrides.push({ partName, contentType });
      return "";
    }
  );

  const ensureOverride = (partName: string, contentType: string) => {
    const existing = overrides.find((entry) => entry.partName === partName);
    if (existing) {
      existing.contentType = contentType;
    } else {
      overrides.push({ partName, contentType });
    }
  };

  ensureOverride("/xl/connections.xml", CONNECTIONS_CONTENT_TYPE);
  ensureOverride("/xl/queryTables/queryTable1.xml", QUERYTABLE_CONTENT_TYPE);
  ensureOverride("/customXml/itemProps1.xml", CUSTOMXML_PROPS_CONTENT_TYPE);
  ensureOverride("/customXml/item1.xml", "application/vnd.ms-excel.mashup+xml");

  const defaultsXml = defaults
    .map((entry) => `  <Default Extension="${entry.extension}" ContentType="${entry.contentType}" />`)
    .join("\r\n");

  const overridesXml = overrides
    .map((entry) => `  <Override PartName="${entry.partName}" ContentType="${entry.contentType}" />`)
    .join("\r\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${
    defaultsXml ? `\r\n${defaultsXml}` : ""
  }${overridesXml ? `\r\n${overridesXml}` : ""}\r\n</Types>`;
};

export async function writePQToExcel(
  excelPath: string,
  mCode: string,
  queryName: string = "Query1"
): Promise<void> {
  const zip = new AdmZip(excelPath);

  const tableXmlOriginal = readXml(zip, "xl/tables/table1.xml");
  const tableNameMatch = tableXmlOriginal.match(/name="([^"]+)"/);
  const tableName = tableNameMatch ? tableNameMatch[1] : queryName;
  const tableRefMatch = tableXmlOriginal.match(/ref="([^"]+)"/);
  const tableRef = tableRefMatch ? tableRefMatch[1] : "A1";
  const columnNames = parseTableColumns(tableXmlOriginal);

  const workbookXmlOriginal = readXml(zip, "xl/workbook.xml");
  const sheetMatch = workbookXmlOriginal.match(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/);
  const sheetName = sheetMatch ? sheetMatch[1] : tableName;
  const sheetRelId = sheetMatch ? sheetMatch[2] : "rId1";

  const sheetXmlOriginal = readXml(zip, "xl/worksheets/sheet1.xml");

  writeUtf8Entry(zip, "xl/styles.xml", BASELINE_STYLES_XML);

  const { start, end } = splitTableReference(tableRef.toUpperCase());
  const definedNameRange = `${quoteSheetName(sheetName)}!${formatAbsoluteCell(start)}:${formatAbsoluteCell(end)}`;

  const sanitizedQueryName = queryName.trim() || tableName;
  const fillCount = Math.max(end.row - start.row, 0);
  const dataMashupBuffer = createDataMashupStream(mCode, {
    queryName: sanitizedQueryName,
    tableName,
    columnNames,
    fillCount,
  });
  const dataMashupBase64 = dataMashupBuffer.toString("base64");

  const mashupGuid = BASELINE_GUIDS.mashupSqmId.toLowerCase();
  const itemPropsGuid = BASELINE_GUIDS.itemPropsId;

  writeUtf16Entry(zip, "customXml/item1.xml", createCustomXmlBuffer(dataMashupBase64, mashupGuid));
  const itemPropsXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\r\n<ds:datastoreItem ds:itemID="${itemPropsGuid}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.microsoft.com/DataMashup"/></ds:schemaRefs></ds:datastoreItem>`;
  writeUtf8Entry(zip, "customXml/itemProps1.xml", itemPropsXml);
  writeUtf8Entry(zip, "customXml/_rels/item1.xml.rels", CUSTOM_XML_REL_XML);

  const columnMetadata = buildColumnMetadata(columnNames, tableXmlOriginal);
  const lineageIds = columnMetadata.map((meta) => meta.id);

  const tableColumnsXml = columnMetadata
    .map((meta) => {
      const dataDxfAttr = meta.dataDxfId ? ` dataDxfId="${meta.dataDxfId}"` : "";
      return `<tableColumn id="${meta.id}" xr3:uid="${meta.uid}" uniqueName="${meta.id}" name="${escapeXmlAttr(
        meta.name
      )}" queryTableFieldId="${meta.id}"${dataDxfAttr}/>`;
    })
    .join("");

  const columnCount = columnMetadata.length;
  const queryTableNextId = Math.max(...lineageIds, 0) + 1;

  const rawTableXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr xr3" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xmlns:xr3="http://schemas.microsoft.com/office/spreadsheetml/2016/revision3" id="1" xr:uid="${BASELINE_GUIDS.tableUid}" name="${escapeXmlAttr(
    tableName
  )}" displayName="${escapeXmlAttr(tableName)}" ref="${tableRef}" tableType="queryTable" totalsRowShown="0"><autoFilter ref="${tableRef}" xr:uid="${BASELINE_GUIDS.autoFilterUid}"/><tableColumns count="${columnCount}">${tableColumnsXml}</tableColumns><tableStyleInfo name="TableStyleMedium7" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
  const tableXml = rawTableXml.replace(/<headerRowCount>.*?<\/headerRowCount>/gis, "");
  writeUtf8Entry(zip, "xl/tables/table1.xml", tableXml);

  const queryTableFieldsXml = columnMetadata
    .map(
      (meta) =>
        `<queryTableField id="${meta.id}" name="${escapeXmlAttr(meta.name)}" tableColumnId="${meta.id}"/>`
    )
    .join("");

  const queryTableXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<queryTable xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr16" xmlns:xr16="http://schemas.microsoft.com/office/spreadsheetml/2017/revision16" name="ExternalData_1" connectionId="1" xr16:uid="${BASELINE_GUIDS.queryTableUid}" autoFormatId="16" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="0"><queryTableRefresh nextId="${queryTableNextId}"><queryTableFields count="${columnCount}">${queryTableFieldsXml}</queryTableFields></queryTableRefresh></queryTable>`;
  writeUtf8Entry(zip, "xl/queryTables/queryTable1.xml", queryTableXml);

  const connectionsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr16" xmlns:xr16="http://schemas.microsoft.com/office/spreadsheetml/2017/revision16"><connection id="1" xr16:uid="${BASELINE_GUIDS.connectionUid}" keepAlive="1" name="${escapeXmlAttr(
    sanitizedQueryName
  )}" description="Connection to the '${escapeXmlAttr(
    sanitizedQueryName
  )}' query in the workbook." type="5" refreshedVersion="8" background="1" saveData="1"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=${escapeXmlAttr(
    sanitizedQueryName
  )};Extended Properties=&quot;&quot;" command="SELECT * FROM [${escapeXmlAttr(
    sanitizedQueryName
  )}]"/></connection></connections>`;
  writeUtf8Entry(zip, "xl/connections.xml", connectionsXml);

  const sheetPr = sheetXmlOriginal.match(/<sheetPr[\s\S]*?<\/sheetPr>/)?.[0] ?? "";
  const dimension = sheetXmlOriginal.match(/<dimension[^>]*\/>/)?.[0] ?? "";
  const sheetViews = sheetXmlOriginal.match(/<sheetViews[\s\S]*?<\/sheetViews>/)?.[0] ?? "";
  const sheetFormatPr = sheetXmlOriginal.match(/<sheetFormatPr[^>]*\/>/)?.[0] ?? "";
  const sheetData = sheetXmlOriginal.match(/<sheetData[\s\S]*?<\/sheetData>/)?.[0] ?? "<sheetData />";
  const pageMargins = sheetXmlOriginal.match(/<pageMargins[^>]*\/>/)?.[0] ?? "";

  const sheetXml = normalizeLineEndings(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${
    sheetPr ? `
${sheetPr}` : ""
  }${dimension ? `
${dimension}` : ""}${sheetViews ? `
${sheetViews}` : ""}${sheetFormatPr ? `
${sheetFormatPr}` : ""}
${sheetData}${
    pageMargins ? `
${pageMargins}` : ""
  }
<tableParts count="1"><tablePart r:id="rId1"/></tableParts>
</worksheet>`);
  writeUtf8Entry(zip, "xl/worksheets/sheet1.xml", sheetXml);

  const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>`;
  writeUtf8Entry(zip, "xl/worksheets/_rels/sheet1.xml.rels", sheetRelsXml);

  const tableRelXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable" Target="../queryTables/queryTable1.xml"/></Relationships>`;
  writeUtf8Entry(zip, "xl/tables/_rels/table1.xml.rels", tableRelXml);

  const workbookPr = workbookXmlOriginal.match(/<workbookPr[\s\S]*?\/>/)?.[0] ?? "";
  const workbookProtection = workbookXmlOriginal.match(/<workbookProtection[\s\S]*?\/>/)?.[0] ?? "";
  const bookViews = workbookXmlOriginal.match(/<bookViews[\s\S]*?<\/bookViews>/)?.[0] ?? "";
  const sheets = workbookXmlOriginal.match(/<sheets[\s\S]*?<\/sheets>/)?.[0] ?? `<sheets><sheet name="${escapeXmlAttr(
    sheetName
  )}" sheetId="1" r:id="${sheetRelId}"/></sheets>`;
  const calcPr = workbookXmlOriginal.match(/<calcPr[\s\S]*?\/>/)?.[0] ?? "";

  const definedNamesXml = `<definedNames><definedName name="ExternalData_1" localSheetId="0" hidden="1">${escapeXmlText(
    definedNameRange
  )}</definedName></definedNames>`;

  const workbookXml = normalizeLineEndings(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${
    workbookPr ? `\n${workbookPr}` : ""
  }${workbookProtection ? `\n${workbookProtection}` : ""}${bookViews ? `\n${bookViews}` : ""}\n${sheets}\n${definedNamesXml}${calcPr ? `\n${calcPr}` : ""}\n</workbook>`);
  writeUtf8Entry(zip, "xl/workbook.xml", workbookXml);

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${sheetRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections" Target="connections.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>`;
  writeUtf8Entry(zip, "xl/_rels/workbook.xml.rels", workbookRelsXml);

  const contentTypesXml = readXml(zip, "[Content_Types].xml");
  writeUtf8Entry(zip, "[Content_Types].xml", updateContentTypes(contentTypesXml));

  removeEntryIfExists(zip, "DataMashup");

  const buffer = zip.toBuffer();
  fs.writeFileSync(excelPath, buffer);
  enforceZipOrderOnDisk(excelPath);
}

