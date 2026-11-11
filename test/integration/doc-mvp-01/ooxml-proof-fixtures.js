'use strict';

const { createHash } = require('node:crypto');
const { deflateRawSync, crc32 } = require('node:zlib');

const FORMAT = Object.freeze({
  docx: Object.freeze({
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    main: 'word/document.xml',
    mainType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
  }),
  xlsx: Object.freeze({
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    main: 'xl/workbook.xml',
    mainType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
  }),
  pptx: Object.freeze({
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    main: 'ppt/presentation.xml',
    mainType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
  })
});

const sha256 = value => createHash('sha256').update(value).digest('hex');
const word = (buffer, offset, value) => buffer.writeUInt16LE(value, offset);
const dword = (buffer, offset, value) => buffer.writeUInt32LE(value >>> 0, offset);

function createZip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const source of entries) {
    const name = Buffer.from(source.name, 'utf8');
    const data = Buffer.isBuffer(source.data) ? source.data : Buffer.from(source.data || '', 'utf8');
    const method = source.store === true ? 0 : 8;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const checksum = crc32(data) >>> 0;
    const localHeader = Buffer.alloc(30);
    dword(localHeader, 0, 0x04034b50); word(localHeader, 4, 20); word(localHeader, 6, 0x800); word(localHeader, 8, method);
    dword(localHeader, 14, checksum); dword(localHeader, 18, compressed.length); dword(localHeader, 22, data.length);
    word(localHeader, 26, name.length); local.push(localHeader, name, compressed);
    const centralHeader = Buffer.alloc(46);
    dword(centralHeader, 0, 0x02014b50); word(centralHeader, 4, 20); word(centralHeader, 6, 20);
    word(centralHeader, 8, 0x800); word(centralHeader, 10, method); dword(centralHeader, 16, checksum);
    dword(centralHeader, 20, compressed.length); dword(centralHeader, 24, data.length); word(centralHeader, 28, name.length);
    dword(centralHeader, 42, offset); central.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  dword(end, 0, 0x06054b50); word(end, 8, entries.length); word(end, 10, entries.length);
  dword(end, 12, directory.length); dword(end, 16, offset);
  return Buffer.concat([...local, directory, end]);
}

const types = overrides => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join('')}</Types>`;
const override = (name, type) => `<Override PartName="/${name}" ContentType="${type}"/>`;
const relationship = (id, type, target, mode = '') => `<Relationship Id="${id}" Type="${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ''}/>`;
const relationships = values => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${values.join('')}</Relationships>`;
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

function docxEntries({ text = 'C4G synthetic OOXML proof', storeDocument = false } = {}) {
  return [
    { name: '[Content_Types].xml', data: types([
      override('word/document.xml', FORMAT.docx.mainType),
      override('word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml')
    ]) },
    { name: '_rels/.rels', data: relationships([
      relationship('rId1', `${OFFICE}officeDocument`, 'word/document.xml')
    ]) },
    { name: 'word/document.xml', store: storeDocument, data: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>` },
    { name: 'word/styles.xml', data: '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>' },
    { name: 'word/_rels/document.xml.rels', data: relationships([relationship('rId1', `${OFFICE}styles`, 'styles.xml')]) }
  ];
}

function xlsxEntries() {
  return [
    { name: '[Content_Types].xml', data: types([
      override('xl/workbook.xml', FORMAT.xlsx.mainType),
      override('xl/worksheets/sheet1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'),
      override('xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml')
    ]) },
    { name: '_rels/.rels', data: relationships([
      relationship('rId1', `${OFFICE}officeDocument`, 'xl/workbook.xml')
    ]) },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Evidence" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: relationships([
      relationship('rId1', `${OFFICE}worksheet`, 'worksheets/sheet1.xml'),
      relationship('rId2', `${OFFICE}styles`, 'styles.xml')
    ]) },
    { name: 'xl/worksheets/sheet1.xml', data: '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>C4G synthetic proof</t></is></c></row></sheetData></worksheet>' },
    { name: 'xl/styles.xml', data: '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>' }
  ];
}

function pptxEntries() {
  return [
    { name: '[Content_Types].xml', data: types([
      override('ppt/presentation.xml', FORMAT.pptx.mainType),
      override('ppt/slides/slide1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'),
      override('ppt/slideMasters/slideMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml'),
      override('ppt/slideLayouts/slideLayout1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'),
      override('ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml')
    ]) },
    { name: '_rels/.rels', data: relationships([relationship('rId1', `${OFFICE}officeDocument`, 'ppt/presentation.xml')]) },
    { name: 'ppt/presentation.xml', data: '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>' },
    { name: 'ppt/_rels/presentation.xml.rels', data: relationships([
      relationship('rId1', `${OFFICE}slideMaster`, 'slideMasters/slideMaster1.xml'),
      relationship('rId2', `${OFFICE}slide`, 'slides/slide1.xml')
    ]) },
    { name: 'ppt/slides/slide1.xml', data: '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>' },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: relationships([relationship('rId1', `${OFFICE}slideLayout`, '../slideLayouts/slideLayout1.xml')]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: '<?xml version="1.0"?><p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sldLayout>' },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: relationships([relationship('rId1', `${OFFICE}slideMaster`, '../slideMasters/slideMaster1.xml')]) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: '<?xml version="1.0"?><p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sldMaster>' },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: relationships([relationship('rId1', `${OFFICE}theme`, '../theme/theme1.xml')]) },
    { name: 'ppt/theme/theme1.xml', data: '<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="C4G"><a:themeElements><a:clrScheme name="C4G"/><a:fontScheme name="C4G"/><a:fmtScheme name="C4G"/></a:themeElements></a:theme>' }
  ];
}

function fixture(id) {
  let extension, entries, expectedStatus, expectedCode, purpose;
  if (id === 'valid-docx') { extension = 'docx'; entries = docxEntries(); expectedStatus = 'APPROVED'; expectedCode = 'OOXML_STRUCTURAL_APPROVED'; purpose = 'Valid WordprocessingML package.'; }
  else if (id === 'valid-xlsx') { extension = 'xlsx'; entries = xlsxEntries(); expectedStatus = 'APPROVED'; expectedCode = 'OOXML_STRUCTURAL_APPROVED'; purpose = 'Valid SpreadsheetML package.'; }
  else if (id === 'valid-pptx') { extension = 'pptx'; entries = pptxEntries(); expectedStatus = 'APPROVED'; expectedCode = 'OOXML_STRUCTURAL_APPROVED'; purpose = 'Valid PresentationML package.'; }
  else if (id === 'external-docx') {
    extension = 'docx'; entries = [...docxEntries(), { name: 'word/_rels/settings.xml.rels', data: relationships([relationship('rId9', `${OFFICE}attachedTemplate`, 'https://example.invalid/template.dotx', 'External')]) }];
    expectedStatus = 'REJECTED'; expectedCode = 'OOXML_EXTERNAL_RELATIONSHIP_FORBIDDEN'; purpose = 'External relationship is rejected.';
  } else if (id === 'active-xlsx') {
    extension = 'xlsx'; entries = [...xlsxEntries(), { name: 'xl/embeddings/oleObject1.bin', data: Buffer.from('synthetic inert OLE marker', 'utf8'), store: true }];
    expectedStatus = 'REJECTED'; expectedCode = 'OOXML_ACTIVE_CONTENT_FORBIDDEN'; purpose = 'Embedded OLE/package content is rejected without executable content.';
  } else if (id === 'broken-pptx') {
    extension = 'pptx'; entries = pptxEntries().map(entry => entry.name === 'ppt/slides/_rels/slide1.xml.rels'
      ? { ...entry, data: relationships([relationship('rId1', `${OFFICE}slideLayout`, '../slideLayouts/missing.xml')]) } : entry);
    expectedStatus = 'REJECTED'; expectedCode = 'OOXML_RELATIONSHIP_TARGET_MISSING'; purpose = 'Missing internal relationship target is rejected.';
  } else if (id === 'expanded-docx') {
    extension = 'docx'; entries = docxEntries({ text: 'x'.repeat(1024 * 1024) });
    expectedStatus = 'REJECTED'; expectedCode = 'OOXML_EXPANSION_LIMIT_EXCEEDED'; purpose = 'Actual expanded XML exceeds the compression-ratio limit.';
  } else if (id === 'cancel-docx') {
    extension = 'docx'; entries = docxEntries({ text: 'c'.repeat(512 * 1024), storeDocument: true });
    expectedStatus = 'APPROVED'; expectedCode = 'OOXML_STRUCTURAL_APPROVED'; purpose = 'Large valid package used for cancellation and retry.';
  } else throw new TypeError('Unknown OOXML proof fixture.');
  const bytes = createZip(entries), format = FORMAT[extension];
  return Object.freeze({ id, extension, mime: format.mime, filename: `${id}.${extension}`, entries: entries.length,
    bytes, size: bytes.length, sha256: sha256(bytes), expectedStatus, expectedCode, purpose });
}

const FIXTURE_IDS = Object.freeze(['valid-docx', 'valid-xlsx', 'valid-pptx', 'external-docx', 'active-xlsx',
  'broken-pptx', 'expanded-docx', 'cancel-docx']);

module.exports = { FIXTURE_IDS, FORMAT, createZip, fixture, sha256 };
