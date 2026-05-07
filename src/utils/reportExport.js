function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function csvEscape(value) {
  const text = normalizeValue(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(columns, rows) {
  const lines = [
    columns.map(col => csvEscape(col.header)).join(','),
    ...rows.map(row => columns.map(col => csvEscape(row[col.key])).join(','))
  ];
  return Buffer.from(`\ufeff${lines.join('\r\n')}`, 'utf8');
}

function escapeXml(value) {
  return normalizeValue(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index) {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function buildXlsx(columns, rows, sheetName = 'Reporte') {
  const allRows = [
    columns.map(col => col.header),
    ...rows.map(row => columns.map(col => row[col.key]))
  ];

  const sheetRows = allRows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');

  const safeSheetName = escapeXml(sheetName).slice(0, 31) || 'Reporte';

  return zipStore([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>`
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    },
    {
      name: 'docProps/core.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:creator>SICIS</dc:creator><dc:title>${safeSheetName}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`
    },
    {
      name: 'docProps/app.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SICIS</Application></Properties>`
    }
  ]);
}

function dbfFieldName(header, index) {
  const cleaned = String(header || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return (cleaned || `CAMPO${index + 1}`).slice(0, 10);
}

function toLatin1Buffer(value, length) {
  const text = normalizeValue(value).replace(/\r?\n/g, ' ');
  const buffer = Buffer.alloc(length, 0x20);
  Buffer.from(text.slice(0, length), 'latin1').copy(buffer, 0);
  return buffer;
}

function buildDbf(columns, rows) {
  const usedNames = new Set();
  const fields = columns.map((col, index) => {
    const maxDataLength = rows.reduce((max, row) => Math.max(max, normalizeValue(row[col.key]).length), 0);
    const baseName = dbfFieldName(col.dbfName || col.header, index);
    let name = baseName;
    let suffix = 1;
    while (usedNames.has(name)) {
      const suffixText = String(suffix++);
      name = `${baseName.slice(0, 10 - suffixText.length)}${suffixText}`;
    }
    usedNames.add(name);

    return {
      key: col.key,
      name,
      length: Math.min(Math.max(normalizeValue(col.header).length, maxDataLength, 1), 254)
    };
  });

  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0);
  const header = Buffer.alloc(headerLength, 0);
  const now = new Date();

  header[0] = 0x03;
  header[1] = now.getFullYear() - 1900;
  header[2] = now.getMonth() + 1;
  header[3] = now.getDate();
  header.writeUInt32LE(rows.length, 4);
  header.writeUInt16LE(headerLength, 8);
  header.writeUInt16LE(recordLength, 10);

  fields.forEach((field, index) => {
    const offset = 32 + index * 32;
    Buffer.from(field.name, 'ascii').copy(header, offset, 0, Math.min(field.name.length, 10));
    header[offset + 11] = 0x43;
    header[offset + 16] = field.length;
  });
  header[headerLength - 1] = 0x0d;

  const records = rows.map(row => {
    const record = Buffer.alloc(recordLength, 0x20);
    record[0] = 0x20;
    let offset = 1;
    fields.forEach(field => {
      toLatin1Buffer(row[field.key], field.length).copy(record, offset);
      offset += field.length;
    });
    return record;
  });

  return Buffer.concat([header, ...records, Buffer.from([0x1a])]);
}

function buildReportFile(format, columns, rows, sheetName) {
  if (format === 'csv') {
    return {
      buffer: buildCsv(columns, rows),
      contentType: 'text/csv; charset=utf-8',
      extension: 'csv'
    };
  }

  if (format === 'xlsx') {
    return {
      buffer: buildXlsx(columns, rows, sheetName),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx'
    };
  }

  if (format === 'dbf') {
    return {
      buffer: buildDbf(columns, rows),
      contentType: 'application/dbf',
      extension: 'dbf'
    };
  }

  throw new Error('Formato de exportacion no valido.');
}

module.exports = { buildReportFile };
