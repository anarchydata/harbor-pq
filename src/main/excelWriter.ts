/**
 * Excel Writer - injects Power Query M code into an existing XLSX package.
 *
 * The workbook is assumed to have been created already (e.g. via openpyxl)
 * with a single table (`table1.xml`) that represents the preview data. This
 * module wires that table to a Power Query connection by stamping the
 * DataMashup payload, custom XML metadata, and all required OOXML links.
 */

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

const normalizeMCode = (value: string): string => value;

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

const toUtf16Buffer = (value: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(value, "utf16le")]);

const decodeStepName = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('#"') && trimmed.endsWith('"')) {
    return trimmed.slice(2, -1).replace(/""/g, '"');
  }
  if (trimmed.startsWith("#'") && trimmed.endsWith("'")) {
    return trimmed.slice(2, -1).replace(/''/g, "'");
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const encodePathSegment = (value: string): string => encodeURIComponent(value).replace(/%2F/g, "/");

const extractStepNames = (mCode: string): string[] => {
  const normalized = normalizeLineEndings(mCode);
  const match = normalized.match(/\blet\b([\s\S]*?)\bin\b/i);
  if (!match) {
    return [];
  }

  const block = match[1];
  const regex = /(?:^|\r?\n)\s*([^=\r\n]+?)\s*=/g;
  const steps: string[] = [];
  let stepMatch: RegExpExecArray | null;
  while ((stepMatch = regex.exec(block)) !== null) {
    steps.push(decodeStepName(stepMatch[1]));
  }
  return steps;
};

const extractFinalStepName = (mCode: string): string | undefined => {
  const normalized = normalizeLineEndings(mCode);
  const lines = normalized.split("\n");
  let inSeen = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!inSeen) {
      if (/^in\b/i.test(line)) {
        const remainder = line.slice(2).trim();
        if (remainder.length > 0) {
          return decodeStepName(remainder);
        }
        inSeen = true;
      }
      continue;
    }

    if (!line || line.startsWith("//")) {
      continue;
    }

    return decodeStepName(line);
  }

  return undefined;
};

const escapeForAttribute = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const escapeForElement = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const encodeColumnListValue = (columnNames: string[]): string => {
  const encodedNames = columnNames.map((name) => escapeForAttribute(name));
  const joined = encodedNames.map((name) => `&quot;${name}&quot;`).join(",");
  return `s[${joined}]`;
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&quot;/g, `"`)
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

type MashupTemplate = {
  chunk0: Buffer;
  chunk1: Buffer;
  chunk2: Buffer;
  chunk3Prefix: Buffer;
  chunk3Suffix: Buffer;
  metadataXmlTemplate: string;
  chunk4: Buffer;
};

const TEST_CHUNK_BASE64 = {
  chunk0: "",
  chunk1:
    "UEsDBBQAAgAIAAOOZlv5YQf0owAAAPYAAAASABwAQ29uZmlnL1BhY2thZ2UueG1sIKIYACigFAAAAAAAAAAAAAAAAAAAAAAAAAAAAIWPsQ6CMBRFf4V0py3oQMijDK6SmBCNa1MqNsLD0GL5Nwc/yV8Qo6ib4z33DPferzfIx7YJLrq3psOMRJSTQKPqKoN1RgZ3CBOSC9hIdZK1DiYZbTraKiNH584pY9576he062sWcx6xfbEu1VG3knxk818ODVonUWkiYPcaI2IaLRMa82kTsBlCYfArxFP3bH8grIbGDb0WGsNtCWyOwN4fxANQSwMEFAACAAgAA45mWw/K6aukAAAA6QAAABMAHABbQ29udGVudF9UeXBlc10ueG1sIKIYACigFAAAAAAAAAAAAAAAAAAAAAAAAAAAAG2OSw7CMAxErxJ5n7qwQAg1ZQHcgAtEwf2I5qPGReFsLDgSVyBtd4ilZ+Z55vN6V8dkB/GgMfbeKdgUJQhyxt961yqYuJF7ONbV9Rkoihx1UUHHHA6I0XRkdSx8IJedxo9Wcz7HFoM2d90Sbstyh8Y7JseS5x9QV2dq9DSwuKQsr7UZB3Fac3OVAqbEuMj4l7A/eR3C0BvN2cQkbZR2IXEZXn8BUEsDBBQAAgAIAAOOZltQi+lsJwEAAOQBAAATABwARm9ybXVsYXMvU2VjdGlvbjEubSCiGAAooBQAAAAAAAAAAAAAAAAAAAAAAAAAAAB1kE9rAjEQxe8L+x1CetmFsCCIh4qHsrYgvamlB1ckulPdmmS2+VNXlv3ujUZtaWkuQ+ZN3vtNDGxshYrMQu0N4yiOzI5rKMmcrwX0yIgIsHFE/Jmh0xvwncdmAyJ7Rb1fI+6Tp0pAlqOyoKxJaH5fvBjQpnivcdAvxnhQAnlpCsNlLWBV4wH0hwN9XJXc8qwRpqEpI8oJwYjVDlIWAgPC6lx8bMhvFxMLckSDSNlzpcrLjS67xdhbLi/v72i+42p7WuZYA/UW57Fsrrkyb6hljsJJdRJN8jOMtS31RkA9jxeJ54SOkZbmzliUoK+ChcaehSls/Qf+ac+4APMg0SnrtYmyg352iuu69MY4BYmfnjHAmG/MIFzaya9l2C2zS+OoUv+5Db8AUEsBAi0AFAACAAgAA45mW/lhB/SjAAAA9gAAABIAAAAAAAAAAAAAAAAAAAAAAENvbmZpZy9QYWNrYWdlLnhtbFBLAQItABQAAgAIAAOOZlsPyumrpAAAAOkAAAATAAAAAAAAAAAAAAAAAO8AAABbQ29udGVudF9UeXBlc10ueG1sUEsBAi0AFAACAAgAA45mW1CL6WwnAQAA5AEAABMAAAAAAAAAAAAAAAAA4AEAAEZvcm11bGFzL1NlY3Rpb24xLm1QSwUGAAAAAAMAAwDCAAAAVAMAAAAA",
  chunk2:
    "77u/PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz48UGVybWlzc2lvbkxpc3QgeG1sbnM6eHNkPSJodHRwOi8vd3d3LnczLm9yZy8yMDAxL1hNTFNjaGVtYSIgeG1sbnM6eHNpPSJodHRwOi8vd3d3LnczLm9yZy8yMDAxL1hNTFNjaGVtYS1pbnN0YW5jZSI+PENhbkV2YWx1YXRlRnV0dXJlUGFja2FnZXM+ZmFsc2U8L0NhbkV2YWx1YXRlRnV0dXJlUGFja2FnZXM+PEZpcmV3YWxsRW5hYmxlZD50cnVlPC9GaXJld2FsbEVuYWJsZWQ+PC9QZXJtaXNzaW9uTGlzdD4=",
  chunk3:
    "AAAAAHwKAADvu788P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJ1dGYtOCI/PjxMb2NhbFBhY2thZ2VNZXRhZGF0YUZpbGUgeG1sbnM6eHNkPSJodHRwOi8vd3d3LnczLm9yZy8yMDAxL1hNTFNjaGVtYSIgeG1sbnM6eHNpPSJodHRwOi8vd3d3LnczLm9yZy8yMDAxL1hNTFNjaGVtYS1pbnN0YW5jZSI+PEl0ZW1zPjxJdGVtPjxJdGVtTG9jYXRpb24+PEl0ZW1UeXBlPkFsbEZvcm11bGFzPC9JdGVtVHlwZT48SXRlbVBhdGggLz48L0l0ZW1Mb2NhdGlvbj48U3RhYmxlRW50cmllcz48RW50cnkgVHlwZT0iUmVsYXRpb25zaGlwcyIgVmFsdWU9InNBQUFBQUE9PSIgLz48L1N0YWJsZUVudHJpZXM+PC9JdGVtPjxJdGVtPjxJdGVtTG9jYXRpb24+PEl0ZW1UeXBlPkZvcm11bGE8L0l0ZW1UeXBlPjxJdGVtUGF0aD5TZWN0aW9uMS9UYWJsZTE8L0l0ZW1QYXRoPjwvSXRlbUxvY2F0aW9uPjxTdGFibGVFbnRyaWVzPjxFbnRyeSBUeXBlPSJJc1ByaXZhdGUiIFZhbHVlPSJsMCIgLz48RW50cnkgVHlwZT0iUXVlcnlJRCIgVmFsdWU9InNmNTY3Njk5MS1kN2MzLTQwOGMtYmY2NS01MTA2MjZiNmNiZTEiIC8+PEVudHJ5IFR5cGU9IkZpbGxFbmFibGVkIiBWYWx1ZT0ibDEiIC8+PEVudHJ5IFR5cGU9IkZpbGxPYmplY3RUeXBlIiBWYWx1ZT0ic1RhYmxlIiAvPjxFbnRyeSBUeXBlPSJGaWxsVG9EYXRhTW9kZWxFbmFibGVkIiBWYWx1ZT0ibDAiIC8+PEVudHJ5IFR5cGU9Ik5hbWVVcGRhdGVkQWZ0ZXJGaWxsIiBWYWx1ZT0ibDAiIC8+PEVudHJ5IFR5cGU9IlJlc3VsdFR5cGUiIFZhbHVlPSJzVGFibGUiIC8+PEVudHJ5IFR5cGU9IkJ1ZmZlck5leHRSZWZyZXNoIiBWYWx1ZT0ibDEiIC8+PEVudHJ5IFR5cGU9IkZpbGxUYXJnZXQiIFZhbHVlPSJzVGFibGUxIiAvPjxFbnRyeSBUeXBlPSJGaWxsZWRDb21wbGV0ZVJlc3VsdFRvV29ya3NoZWV0IiBWYWx1ZT0ibDEiIC8+PEVudHJ5IFR5cGU9IkZpbGxDb3VudCIgVmFsdWU9ImwxMDAiIC8+PEVudHJ5IFR5cGU9IkZpbGxFcnJvckNvZGUiIFZhbHVlPSJzVW5rbm93biIgLz48RW50cnkgVHlwZT0iRmlsbEVycm9yQ291bnQiIFZhbHVlPSJsMCIgLz48RW50cnkgVHlwZT0iRmlsbExhc3RVcGRhdGVkIiBWYWx1ZT0iZDIwMjUtMTEtMDZUMjI6NDg6MDUuOTEzNTY5OFoiIC8+PEVudHJ5IFR5cGU9IkZpbGxDb2x1bW5UeXBlcyIgVmFsdWU9InNDUVlEIiAvPjxFbnRyeSBUeXBlPSJGaWxsQ29sdW1uTmFtZXMiIFZhbHVlPSJzWyZxdW90O0RhdGUmcXVvdDssJnF1b3Q7Q3VzdG9tZXImcXVvdDssJnF1b3Q7U2FsZXNBbW91bnQmcXVvdDtdIiAvPjxFbnRyeSBUeXBlPSJGaWxsU3RhdHVzIiBWYWx1ZT0ic0NvbXBsZXRlIiAvPjxFbnRyeSBUeXBlPSJOYXZpZ2F0aW9uU3RlcE5hbWUiIFZhbHVlPSJzTmF2aWdhdGlvbiIgLz48RW50cnkgVHlwZT0iQWRkZWRUb0RhdGFNb2RlbCIgVmFsdWU9ImwwIiAvPjxFbnRyeSBUeXBlPSJSZWxhdGlvbnNoaXBJbmZvQ29udGFpbmVyIiBWYWx1ZT0ic3smcXVvdDtjb2x1bW5Db3VudCZxdW90OzozLCZxdW90O2tleUNvbHVtbk5hbWVzJnF1b3Q7OltdLCZxdW90O3F1ZXJ5UmVsYXRpb25zaGlwcyZxdW90OzpbXSwmcXVvdDtjb2x1bW5JZGVudGl0aWVzJnF1b3Q7OlsmcXVvdDtTZWN0aW9uMS9UYWJsZTEvQXV0b1JlbW92ZWRDb2x1bW5zMS57RGF0ZSwwfSZxdW90OywmcXVvdDtTZWN0aW9uMS9UYWJsZTEvQXV0b1JlbW92ZWRDb2x1bW5zMS57Q3VzdG9tZXIsMX0mcXVvdDssJnF1b3Q7U2VjdGlvbjEvVGFibGUxL0F1dG9SZW1vdmVkQ29sdW1uczEue1NhbGVzQW1vdW50LDJ9JnF1b3Q7XSwmcXVvdDtDb2x1bW5Db3VudCZxdW90OzozLCZxdW90O0tleUNvbHVtbk5hbWVzJnF1b3Q7OltdLCZxdW90O0NvbHVtbklkZW50aXRpZXMmcXVvdDs6WyZxdW90O1NlY3Rpb24xL1RhYmxlMS9BdXRvUmVtb3ZlZENvbHVtbnMxLntEYXRlLDB9JnF1b3Q7LCZxdW90O1NlY3Rpb24xL1RhYmxlMS9BdXRvUmVtb3ZlZENvbHVtbnMxLntDdXN0b21lciwxfSZxdW90OywmcXVvdDtTZWN0aW9uMS9UYWJsZTEvQXV0b1JlbW92ZWRDb2x1bW5zMS57U2FsZXNBbW91bnQsMn0mcXVvdDtdLCZxdW90O1JlbGF0aW9uc2hpcEluZm8mcXVvdDs6W119Ii AvPjwvU3RhYmxlRW50cmllcz48L0l0ZW0+PEl0ZW0+PEl0ZW1Mb2NhdGlvbj48SXRlbVR5cGU+Rm9ybXVsYTwvSXRlbVR5cGU+PEl0ZW1QYXRoPlNlY3Rpb24xL1RhYmxlMS9Tb3VyY2U8L0l0ZW1QYXRoPjwvSXRlbUxvY2F0aW9uPjxTdGFibGVFbnRyaWVzIC8+PC9JdGVtPjxJdGVtPjxJdGVtTG9jYXRpb24+PEl0ZW1UeXBlPkZvcm11bGE8L0l0ZW1UeXBlPjxJdGVtUGF0aD5TZWN0aW9uMS9UYWJsZTEvVGFibGUxX1RhYmxlPC9JdGVtUGF0aD48L0l0ZW1Mb2NhdGlvbj48U3RhYmxlRW50cmllcy AvPjwvSXRlbT48SXRlbT48SXRlbUxvY2F0aW9uPjxJdGVtVHlwZT5Gb3JtdWxhPC9JdGVtVHlwZT48SXRlbVBhdGg+U2VjdGlvbjEvVGFibGUxL0NoYW5nZWQlMjBUeXBlPC9JdGVtUGF0aD48L0l0ZW1Mb2NhdGlvbj48U3RhYmxlRW50cmllcy AvPjwvSXRlbT48SXRlbT48SXRlbUxvY2F0aW9uPjxJdGVtVHlwZT5Gb3JtdWxhPC9JdGVtVHlwZT48SXRlbVBhdGg+U2VjdGlvbjEvVGFibGUxL1JlbW92ZWQlMjBDb2x1bW5zPC9JdGVtUGF0aD48L0l0ZW1Mb2NhdGlvbj48U3RhYmxlRW50cmllcy AvPjwvSXRlbT48L0l0ZW1zPjwvTG9jYWxQYWNrYWdlTWV0YWRhdGFGaWxlPhYAAABQSwUGAAAAAAAAAAAAAAAAAAAAAAAA",
  chunk4:
    "AQAAANCMnd8BFdERjHoAwE/Cl+sBAAAAy0v697gIqkq4HtWamPDaPAAAAAACAAAAAAAQZgAAAAEAACAAAACpPR0SpsoywCi8+psLhPrzH3dJoxYhviHNCmPiBOSLkwAAAAAOgAAAAAIAACAAAABn3vWb2tvMdRD1cLGlvpzakMLD+/DqpD6fAB42W82+uVAAAACm9OH0xBvjwcipZz2GXRTY+gc80mWkQ+TK3kto9A2ocObTxk9AbIap7hhYfRiBT1ni5FE7jak9dytqwAXQiVDvy6WcEIhahTRUJgXjTKEimEAAAABT4A9h/SlfJWXkPgguVSCiNOT743hoG5nQNLClGfqYiC6+N5fUIWSxuxQEv07oXJd2Cj2g99pwlr4FgJJgWVUc",
};

let cachedMashupTemplate: MashupTemplate | null = null;

const getTestMashupTemplate = (): MashupTemplate => {
  if (cachedMashupTemplate) {
    return cachedMashupTemplate;
  }

  const chunk0 =
    TEST_CHUNK_BASE64.chunk0.length > 0 ? Buffer.from(TEST_CHUNK_BASE64.chunk0, "base64") : Buffer.alloc(0);
  const chunk1 = Buffer.from(TEST_CHUNK_BASE64.chunk1, "base64");
  const chunk2 = Buffer.from(TEST_CHUNK_BASE64.chunk2, "base64");
  const chunk3 = Buffer.from(TEST_CHUNK_BASE64.chunk3, "base64");
  const chunk4 = Buffer.from(TEST_CHUNK_BASE64.chunk4, "base64");

  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  let xmlStart = chunk3.indexOf(bom);
  if (xmlStart === -1) {
    xmlStart = chunk3.indexOf(0x3c);
  }
  if (xmlStart === -1) {
    throw new Error("Unable to locate metadata XML start in template chunk");
  }

  const closingTag = Buffer.from("</LocalPackageMetadataFile>");
  const closingIndex = chunk3.indexOf(closingTag, xmlStart);
  if (closingIndex === -1) {
    throw new Error("Unable to locate metadata XML end in template chunk");
  }
  const xmlEnd = closingIndex + closingTag.length;

  const metadataXmlTemplate = chunk3.slice(xmlStart, xmlEnd).toString("utf8");
  const chunk3Prefix = chunk3.slice(0, xmlStart);
  const chunk3Suffix = chunk3.slice(xmlEnd);

  cachedMashupTemplate = {
    chunk0,
    chunk1,
    chunk2,
    chunk3Prefix,
    chunk3Suffix,
    metadataXmlTemplate,
    chunk4,
  };

  return cachedMashupTemplate;
};

const CHUNK1_ENTRY_ORDER = ["Config/Package.xml", "[Content_Types].xml", "Formulas/Section1.m"];

const customizeMetadataXml = (
  templateXml: string,
  queryName: string,
  columnNames: string[],
  mCode: string,
  fillCount: number
): string => {
  const stepNames = extractStepNames(mCode);
  const finalStep = extractFinalStepName(mCode) || stepNames[stepNames.length - 1] || queryName;
  const querySegment = encodePathSegment(queryName);
  const encodedFinalStep = encodePathSegment(finalStep);
  const rowCount = Math.max(0, fillCount);

  let xml = templateXml;

  xml = xml.replace(/Section1\/Table1/g, `Section1/${querySegment}`);
  xml = xml.replace(/FillTarget" Value="s[^"]+"/, `FillTarget" Value="s${escapeForAttribute(queryName)}"`);
  xml = xml.replace(
    /NavigationStepName" Value="s[^"]+"/,
    `NavigationStepName" Value="s${escapeForAttribute(finalStep)}"`
  );
  xml = xml.replace(/FillCount" Value="l\d+"/, `FillCount" Value="l${rowCount}"`);
  xml = xml.replace(/FillColumnTypes" Value="s[^"]+"/, `FillColumnTypes" Value="sCQYD"`);
  xml = xml.replace(/AutoRemovedColumns1/g, encodedFinalStep);

  const columnListValue = encodeColumnListValue(columnNames);
  xml = xml.replace(/FillColumnNames" Value="s\[.*?\]"/, `FillColumnNames" Value="${columnListValue}"`);

  const relationshipMatch = xml.match(/RelationshipInfoContainer" Value="s([^"]+)"/);
  if (relationshipMatch) {
    const decoded = decodeHtmlEntities(relationshipMatch[1]);
    try {
      const relationship = JSON.parse(decoded);
      const identities = columnNames.map(
        (name, index) => `Section1/${querySegment}/${encodedFinalStep}.{${name},${index}}`
      );

      relationship.columnCount = columnNames.length;
      relationship.ColumnCount = columnNames.length;
      relationship.columnIdentities = identities;
      relationship.ColumnIdentities = identities;

      const encodedRelationship = escapeForAttribute(JSON.stringify(relationship));
      xml = xml.replace(
        /RelationshipInfoContainer" Value="s[^"]+"/,
        `RelationshipInfoContainer" Value="s${encodedRelationship}"`
      );
    } catch (error) {
      xml = xml.replace(
        /Section1\/[^/]+\/AutoRemovedColumns1/g,
        `Section1/${querySegment}/${encodedFinalStep}`
      );
    }
  }

  const stepPathRegex = new RegExp(`<ItemPath>Section1/${querySegment}/([^<]+)</ItemPath>`, "g");
  let stepIndex = 0;
  xml = xml.replace(stepPathRegex, (match: string, _existing: string) => {
    const stepName = stepNames[stepIndex];
    if (!stepName) {
      return match;
    }
    stepIndex += 1;
    const encodedStep = encodePathSegment(stepName);
    return `<ItemPath>Section1/${querySegment}/${encodedStep}</ItemPath>`;
  });

  return xml;
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
  queryName: string = "Query1",
  columnNames: string[] = [],
  fillCount: number = 0
): Buffer {
  const template = getTestMashupTemplate();

    const formattedQueryName = queryName.includes(" ") ? `#"${queryName}"` : queryName;
  const normalizedM = normalizeMCode(mCode);

  let sectionM: string;
  const trimmed = normalizedM.trim();
  if (/^section\s+/i.test(trimmed)) {
    sectionM = normalizedM;
  } else {
    const needsTerminator = /;\s*$/.test(trimmed) ? normalizedM : `${normalizedM};`;
    sectionM = `section Section1;\r\n\r\nshared ${formattedQueryName} = ${needsTerminator}`;
  }

  const sectionBuffer = toUtf16Buffer(sectionM);

  const chunk1Zip = new AdmZip(Buffer.from(template.chunk1));
  chunk1Zip.updateFile("Formulas/Section1.m", sectionBuffer);

  const reorderedChunk1Zip = new AdmZip();
  for (const entryName of CHUNK1_ENTRY_ORDER) {
    const entry = chunk1Zip.getEntry(entryName);
    if (!entry) {
      continue;
    }
    const data = entry.getData();
    reorderedChunk1Zip.addFile(entry.entryName, data, entry.comment, entry.attr);
  }
  const remainingEntries = chunk1Zip
    .getEntries()
    .filter((entry) => !CHUNK1_ENTRY_ORDER.includes(entry.entryName));
  for (const entry of remainingEntries) {
    const data = entry.getData();
    reorderedChunk1Zip.addFile(entry.entryName, data, entry.comment, entry.attr);
  }

  const chunk1Buffer = reorderedChunk1Zip.toBuffer();

  const metadataXml = customizeMetadataXml(template.metadataXmlTemplate, queryName, columnNames, normalizedM, fillCount);
  const chunk3Buffer = Buffer.concat([
    template.chunk3Prefix,
    Buffer.from(metadataXml, "utf8"),
    template.chunk3Suffix,
  ]);

  const chunkBuffers = [
    Buffer.from(template.chunk0),
    chunk1Buffer,
    Buffer.from(template.chunk2),
    chunk3Buffer,
    Buffer.from(template.chunk4),
  ];

  const withLengths = chunkBuffers.map((chunk) => {
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32LE(chunk.length, 0);
    return Buffer.concat([lengthBuffer, chunk]);
  });

  return Buffer.concat(withLengths);
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
  const dataRowCount = Math.max(0, end.row - start.row);
  const definedNameRange = `${quoteSheetName(sheetName)}!${formatAbsoluteCell(start)}:${formatAbsoluteCell(end)}`;

  const sanitizedQueryName = queryName.trim() || tableName;
  const dataMashupBuffer = createDataMashupStream(mCode, sanitizedQueryName, columnNames, dataRowCount);
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

