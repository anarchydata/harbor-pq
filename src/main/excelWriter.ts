/**
 * Excel Writer - Writes Power Query M code to Excel files using MS-XLSX format
 * Based on MS-XLSX specification and MS-QDEFF format for DataMashup
 */

import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";

/**
 * Create MS-QDEFF formatted DataMashup binary stream
 * Format: Package Parts (zip) + Metadata (XML) + Permissions (XML) + Permission Bindings (binary) + Metadata Content (zip)
 */
function createDataMashupStream(mCode: string, queryName: string = "Query1"): Buffer {
  // Create temporary directory structure
  const tempDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "pq-excel-"));
  const packageDir = path.join(tempDir, "PackageParts");
  const configDir = path.join(packageDir, "Config");
  const formulasDir = path.join(packageDir, "Formulas");

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(formulasDir, { recursive: true });

  try {
    // 1. Create Package.xml
    const packageXml = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/DataMashup">
  <ClientVersion>2.0</ClientVersion>
  <MinServerVersion>1.0</MinServerVersion>
  <Culture>en-US</Culture>
</Package>`;
    fs.writeFileSync(path.join(configDir, "Package.xml"), packageXml, "utf-8");

    // 2. Create Section1.m with the M code
    // Format: section Section1; shared QueryName = Formula;
    const formattedQueryName = queryName.includes(" ") ? `#"${queryName}"` : queryName;
    const sectionM = `section Section1;
shared ${formattedQueryName} = ${mCode};
`;
    fs.writeFileSync(path.join(formulasDir, "Section1.m"), sectionM, "utf-8");

    // 3. Create Package Parts zip
    const packageZip = new AdmZip();
    packageZip.addLocalFolder(packageDir, "PackageParts");
    const packageZipBuffer = packageZip.toBuffer();

    // 4. Create Metadata XML
    const metadataXml = `<?xml version="1.0" encoding="utf-8"?>
<AllFormulas xmlns="http://schemas.microsoft.com/DataMashup">
  <Formulas>
    <Formula Name="Section1/${queryName}">
      <FormulaExpression>Section1/${queryName}</FormulaExpression>
    </Formula>
  </Formulas>
</AllFormulas>`;

    // 5. Create Permissions XML
    const permissionsXml = `<?xml version="1.0" encoding="utf-8"?>
<Permissions xmlns="http://schemas.microsoft.com/DataMashup">
  <CanEvaluateFuturePackages>false</CanEvaluateFuturePackages>
  <FirewallEnabled>false</FirewallEnabled>
  <WorkbookGroupType xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" />
</Permissions>`;

    // 6. Create Permission Bindings (empty binary)
    const permissionBindings = Buffer.alloc(0);

    // 7. Create Metadata Content (empty zip)
    const metadataContentZip = new AdmZip();
    const metadataContentBuffer = metadataContentZip.toBuffer();

    // 8. Combine all components into MS-QDEFF binary stream
    // Format: [Package Parts][Metadata][Permissions][Permission Bindings][Metadata Content]
    // Each component is prefixed with its length (4 bytes, little-endian)
    const metadataBuffer = Buffer.from(metadataXml, "utf-8");
    const permissionsBuffer = Buffer.from(permissionsXml, "utf-8");

    // Calculate sizes
    const packagePartsSize = packageZipBuffer.length;
    const metadataSize = metadataBuffer.length;
    const permissionsSize = permissionsBuffer.length;
    const permissionBindingsSize = permissionBindings.length;
    const metadataContentSize = metadataContentBuffer.length;

    // Create the combined buffer
    const totalSize =
      4 + packagePartsSize + // Package Parts size + data
      4 + metadataSize + // Metadata size + data
      4 + permissionsSize + // Permissions size + data
      4 + permissionBindingsSize + // Permission Bindings size + data
      4 + metadataContentSize; // Metadata Content size + data

    const combinedBuffer = Buffer.alloc(totalSize);
    let offset = 0;

    // Write Package Parts
    combinedBuffer.writeUInt32LE(packagePartsSize, offset);
    offset += 4;
    packageZipBuffer.copy(combinedBuffer, offset);
    offset += packagePartsSize;

    // Write Metadata
    combinedBuffer.writeUInt32LE(metadataSize, offset);
    offset += 4;
    metadataBuffer.copy(combinedBuffer, offset);
    offset += metadataSize;

    // Write Permissions
    combinedBuffer.writeUInt32LE(permissionsSize, offset);
    offset += 4;
    permissionsBuffer.copy(combinedBuffer, offset);
    offset += permissionsSize;

    // Write Permission Bindings
    combinedBuffer.writeUInt32LE(permissionBindingsSize, offset);
    offset += 4;
    permissionBindings.copy(combinedBuffer, offset);
    offset += permissionBindingsSize;

    // Write Metadata Content
    combinedBuffer.writeUInt32LE(metadataContentSize, offset);
    offset += 4;
    metadataContentBuffer.copy(combinedBuffer, offset);

    return combinedBuffer;
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.error("[ExcelWriter] Error cleaning up temp directory:", err);
    }
  }
}

/**
 * Write Power Query M code to an Excel file
 * Adds DataMashup part according to MS-XLSX specification
 */
export async function writePQToExcel(
  excelPath: string,
  mCode: string,
  queryName: string = "Query1"
): Promise<void> {
  // Read existing Excel file as zip
  const zip = new AdmZip(excelPath);

  // Create DataMashup binary stream
  const dataMashupBuffer = createDataMashupStream(mCode, queryName);

  // Add DataMashup part
  zip.addFile("DataMashup", dataMashupBuffer);

  // Update [Content_Types].xml
  let contentTypesXml = zip.readAsText("[Content_Types].xml", "utf8");
  if (!contentTypesXml) {
    // Create new Content_Types.xml if it doesn't exist
    contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="xml" ContentType="application/xml" />
  <Override PartName="/DataMashup" ContentType="application/vnd.ms-powerquery.package" />
</Types>`;
  } else {
    // Check if DataMashup override already exists
    if (!contentTypesXml.includes('PartName="/DataMashup"')) {
      // Insert before closing </Types>
      contentTypesXml = contentTypesXml.replace(
        "</Types>",
        '  <Override PartName="/DataMashup" ContentType="application/vnd.ms-powerquery.package" />\n</Types>'
      );
    }
  }
  zip.updateFile("[Content_Types].xml", Buffer.from(contentTypesXml, "utf-8"));

  // Update _rels/.rels to include DataMashup relationship
  let relsXml = zip.readAsText("_rels/.rels", "utf8");
  if (!relsXml) {
    // Create new .rels if it doesn't exist
    relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml" />
  <Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2017/10/relationships/dataMashup" Target="/DataMashup" />
</Relationships>`;
  } else {
    // Check if DataMashup relationship already exists
    if (!relsXml.includes('Type="http://schemas.microsoft.com/office/2017/10/relationships/dataMashup"')) {
      // Find the last Relationship and add after it
      const lastRelMatch = relsXml.match(/<Relationship[^>]*\/>/g);
      if (lastRelMatch) {
        const lastRel = lastRelMatch[lastRelMatch.length - 1];
        const lastRelId = lastRel.match(/Id="([^"]+)"/)?.[1] || "rId1";
        const nextId = `rId${parseInt(lastRelId.replace("rId", "")) + 1}`;
        const newRel = `  <Relationship Id="${nextId}" Type="http://schemas.microsoft.com/office/2017/10/relationships/dataMashup" Target="/DataMashup" />\n`;
        relsXml = relsXml.replace("</Relationships>", newRel + "</Relationships>");
      }
    }
  }
  zip.updateFile("_rels/.rels", Buffer.from(relsXml, "utf-8"));

  // Write the updated zip back to file
  zip.writeZip(excelPath);
}

