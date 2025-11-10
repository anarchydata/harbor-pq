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
  mashupSqmId: "{9e308c46-fb1c-4f88-bc69-8c859c398232}",
  connectionUid: "{435557DE-A9E1-472E-9CED-43922ADC57DA}",
  tableUid: "{93C3A517-6B98-4E58-BAD7-C376312A0970}",
  autoFilterUid: "{93C3A517-6B98-4E58-BAD7-C376312A0970}",
  queryTableUid: "{48FF3DD1-7251-4652-815E-EE8EB667BCEB}",
};

const BASELINE_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac x16r2 xr" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:x16r2="http://schemas.openxmlformats.org/spreadsheetml/2015/02/main" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision"><fonts count="1" x14ac:knownFonts="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="2"><dxf><numFmt numFmtId="19" formatCode="m/d/yyyy"/></dxf><dxf><numFmt numFmtId="0" formatCode="General"/></dxf></dxfs><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/><extLst><ext uri="{EB79DEF2-80B8-43e5-95BD-54CBDDF9020C}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:slicerStyles defaultSlicerStyle="SlicerStyleLight1"/></ext><ext uri="{9260A510-F301-46a8-8635-F512D64BE5F5}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:timelineStyles defaultTimelineStyle="TimeSlicerStyleLight1"/></ext></extLst></styleSheet>`;

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
const BASELINE_EXT_LST =
  '<extLst><ext uri="{140A7094-0E35-4892-8432-C4D2E57EDEB5}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:workbookPr chartTrackingRefBase="1"/></ext></extLst>';

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

const adjustSourceTableReference = (mCode: string, tableName: string): string => {
  const escaped = tableName.replace(/"/g, '""');
  return mCode.replace(
    /Excel\.CurrentWorkbook\(\)\{\s*\[Name\s*=\s*"([^"]*)"\s*\]\s*\}\[Content\]/g,
    `Excel.CurrentWorkbook(){[Name="${escaped}"]}[Content]`
  );
};

function createDataMashupStream(mCode: string, queryName: string = "Query1"): Buffer {
  const tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "pq-excel-"));
  const packageDir = path.join(tempDir, "PackageParts");
  const configDir = path.join(packageDir, "Config");
  const formulasDir = path.join(packageDir, "Formulas");

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(formulasDir, { recursive: true });

  try {
    const packageXml = normalizeLineEndings(`<?xml version="1.0" encoding="utf-8"?>\n<Package xmlns="http://schemas.microsoft.com/DataMashup">\n  <ClientVersion>2.0</ClientVersion>\n  <MinServerVersion>1.0</MinServerVersion>\n  <Culture>en-US</Culture>\n</Package>`);
    fs.writeFileSync(path.join(configDir, "Package.xml"), packageXml, "utf-8");

    const formattedQueryName = queryName.includes(" ") ? `#"${queryName}"` : queryName;
    const normalizedM = normalizeMCode(mCode);
    const mCodeWithTerminator = normalizedM.endsWith(";") ? normalizedM : `${normalizedM};`;
    const sectionM = `section Section1;\r\n\r\nshared ${formattedQueryName} = ${mCodeWithTerminator}`;
    fs.writeFileSync(path.join(formulasDir, "Section1.m"), sectionM, "utf-8");

    const packageZip = new AdmZip();
    packageZip.addLocalFolder(packageDir, "PackageParts");
    const packageZipBuffer = packageZip.toBuffer();

    const metadataQueryPath = queryName.includes(" ")
      ? `Section1/#"${queryName.replace(/"/g, '""')}"`
      : `Section1/${queryName}`;

    const metadataXml = normalizeLineEndings(`<?xml version="1.0" encoding="utf-8"?>\n<AllFormulas xmlns="http://schemas.microsoft.com/DataMashup">\n  <Formulas>\n    <Formula Name="${metadataQueryPath}">\n      <FormulaExpression>${metadataQueryPath}</FormulaExpression>\n    </Formula>\n  </Formulas>\n</AllFormulas>`);

    const permissionsXml = normalizeLineEndings(`<?xml version="1.0" encoding="utf-8"?>\n<Permissions xmlns="http://schemas.microsoft.com/DataMashup">\n  <CanEvaluateFuturePackages>false</CanEvaluateFuturePackages>\n  <FirewallEnabled>false</FirewallEnabled>\n  <WorkbookGroupType xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" />\n</Permissions>`);

    const metadataBuffer = Buffer.from(metadataXml, "utf-8");
    const permissionsBuffer = Buffer.from(permissionsXml, "utf-8");
    const permissionBindings = Buffer.alloc(0);
    const metadataContentBuffer = new AdmZip().toBuffer();

    const totalSize =
      4 + packageZipBuffer.length +
      4 + metadataBuffer.length +
      4 + permissionsBuffer.length +
      4 + permissionBindings.length +
      4 + metadataContentBuffer.length;

    const combinedBuffer = Buffer.alloc(totalSize);
    let offset = 0;

    combinedBuffer.writeUInt32LE(packageZipBuffer.length, offset);
    offset += 4;
    packageZipBuffer.copy(combinedBuffer, offset);
    offset += packageZipBuffer.length;

    combinedBuffer.writeUInt32LE(metadataBuffer.length, offset);
    offset += 4;
    metadataBuffer.copy(combinedBuffer, offset);
    offset += metadataBuffer.length;

    combinedBuffer.writeUInt32LE(permissionsBuffer.length, offset);
    offset += 4;
    permissionsBuffer.copy(combinedBuffer, offset);
    offset += permissionsBuffer.length;

    combinedBuffer.writeUInt32LE(permissionBindings.length, offset);
    offset += 4;
    permissionBindings.copy(combinedBuffer, offset);
    offset += permissionBindings.length;

    combinedBuffer.writeUInt32LE(metadataContentBuffer.length, offset);
    offset += 4;
    metadataContentBuffer.copy(combinedBuffer, offset);

    return combinedBuffer;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error("[ExcelWriter] Error cleaning up temp directory:", err);
    }
  }
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
  const adjustedMCode = adjustSourceTableReference(mCode, tableName);
  const dataMashupBuffer = createDataMashupStream(adjustedMCode, sanitizedQueryName);
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
  const tableXml = rawTableXml
    .replace(/\s+headerRowCount="[^"]*"/gi, "")
    .replace(/<headerRowCount>.*?<\/headerRowCount>/gis, "");
  writeUtf8Entry(zip, "xl/tables/table1.xml", tableXml);

  const queryTableFieldsXml = columnMetadata
    .map(
      (meta) =>
        `<queryTableField id="${meta.id}" name="${escapeXmlAttr(meta.name)}" tableColumnId="${meta.id}"/>`
    )
    .join("");

  const queryTableXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<queryTable xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr16" xmlns:xr16="http://schemas.microsoft.com/office/spreadsheetml/2017/revision16" name="ExternalData_1" connectionId="1" xr16:uid="${BASELINE_GUIDS.queryTableUid}" autoFormatId="16" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="0"><queryTableRefresh nextId="${queryTableNextId}"><queryTableFields count="${columnCount}">${queryTableFieldsXml}</queryTableFields></queryTableRefresh></queryTable>`;
  writeUtf8Entry(zip, "xl/queryTables/queryTable1.xml", queryTableXml);

  const connectionDisplayName = `Query - ${sanitizedQueryName}`;
  const connectionsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr16" xmlns:xr16="http://schemas.microsoft.com/office/spreadsheetml/2017/revision16"><connection id="1" xr16:uid="${BASELINE_GUIDS.connectionUid}" keepAlive="1" name="${escapeXmlAttr(
    connectionDisplayName
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

  const sheetXml = normalizeLineEndings(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${
    sheetPr ? `\n${sheetPr}` : ""
  }${dimension ? `\n${dimension}` : ""}${sheetViews ? `\n${sheetViews}` : ""}${sheetFormatPr ? `\n${sheetFormatPr}` : ""}\n${sheetData}${
    pageMargins ? `\n${pageMargins}` : ""
  }\n<tableParts count="1"><tablePart r:id="rId1"/></tableParts>\n<queryTableParts count="1"><queryTablePart r:id="rId2"/></queryTableParts>\n</worksheet>`);
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
  const extLst =
    workbookXmlOriginal.match(/<extLst[\s\S]*?<\/extLst>/)?.[0] ?? BASELINE_EXT_LST;

  const definedNamesXml = `<definedNames><definedName name="ExternalData_1" localSheetId="0" hidden="1">${escapeXmlText(
    definedNameRange
  )}</definedName></definedNames>`;

  const workbookXml = normalizeLineEndings(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${
    workbookPr ? `\n${workbookPr}` : ""
  }${workbookProtection ? `\n${workbookProtection}` : ""}${bookViews ? `\n${bookViews}` : ""}\n${sheets}\n${definedNamesXml}${calcPr ? `\n${calcPr}` : ""}\n${extLst}\n</workbook>`);
  writeUtf8Entry(zip, "xl/workbook.xml", workbookXml);

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${sheetRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections" Target="connections.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>`;
  writeUtf8Entry(zip, "xl/_rels/workbook.xml.rels", workbookRelsXml);

  const contentTypesXml = readXml(zip, "[Content_Types].xml");
  writeUtf8Entry(zip, "[Content_Types].xml", updateContentTypes(contentTypesXml));

  removeEntryIfExists(zip, "DataMashup");

  zip.writeZip(excelPath);
}

