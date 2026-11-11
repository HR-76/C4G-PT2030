'use strict';

const path = require('node:path');
const { Readable } = require('node:stream');
const { crc32 } = require('node:zlib');
const yauzl = require('yauzl');
const { SaxesParser } = require('saxes');
const { FILE_CLASSES, LIMITS } = require('./constants');

const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_RELATIONSHIPS = Object.freeze(new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument'
]));
const FORMATS = Object.freeze({
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': Object.freeze({
    extension: 'docx', mainPart: 'word/document.xml', mainRoot: 'document',
    mainNamespace: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    mainContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
  }),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': Object.freeze({
    extension: 'xlsx', mainPart: 'xl/workbook.xml', mainRoot: 'workbook',
    mainNamespace: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    mainContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
  }),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': Object.freeze({
    extension: 'pptx', mainPart: 'ppt/presentation.xml', mainRoot: 'presentation',
    mainNamespace: 'http://schemas.openxmlformats.org/presentationml/2006/main',
    mainContentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
  })
});
const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 4096,
  maxEntryBytes: 100 * 1024 * 1024,
  maxXmlBytes: 16 * 1024 * 1024,
  maxExpandedBytes: 200 * 1024 * 1024,
  maxExpansionRatio: 4,
  maxPathSegments: 32,
  maxPathBytes: 1024,
  maxProcessingMs: 30000,
  processingChunkBytes: 64 * 1024
});
const FORBIDDEN_PART = /(^|\/)(?:activeX|embeddings|externalLinks)(?:\/|$)|(?:vbaProject|activeX|oleObject)\.(?:bin|xml|rels)$|\.(?:exe|dll|com|scr|msi|js|jse|vbs|vbe|ps1|bat|cmd|jar|chm)$/i;
const FORBIDDEN_CONTENT_TYPE = /(?:macroEnabled|vbaProject|activeX|oleObject|msdownload|x-msdownload|executable)/i;
const FORBIDDEN_RELATIONSHIP = /\/(?:activeX|oleObject|package|attachedTemplate|externalLink)(?:$|\/)/i;

class StructuralRejection extends Error {
  constructor(code) { super(code); this.code = code; }
}
class StructuralTransientError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const reject = code => { throw new StructuralRejection(code); };
const transient = code => new StructuralTransientError(code);
const immediate = () => new Promise(resolve => setImmediate(resolve));
const local = name => String(name || '').split(':').at(-1);
function attribute(node, name) {
  const found = Object.values(node.attributes || {}).find(value => local(value.name || value.local) === name);
  return found && typeof found === 'object' ? found.value : found;
}
function validateLimits(value) {
  const limits = Object.freeze({ ...DEFAULT_LIMITS, ...(value || {}) });
  for (const key of Reflect.ownKeys(DEFAULT_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > DEFAULT_LIMITS[key]) {
      throw new TypeError('OOXML structural limits may only be tightened.');
    }
  }
  return limits;
}
function validateEntryName(value, limits) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > limits.maxPathBytes
    || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[a-z]:/i.test(value)
    || value.includes('//') || value.includes('%')) reject('OOXML_PATH_INVALID');
  const directory = value.endsWith('/');
  const source = directory ? value.slice(0, -1) : value;
  const segments = source.split('/');
  if (!source || segments.length > limits.maxPathSegments || segments.some(segment => !segment || segment === '.' || segment === '..'
    || segment.normalize('NFC') !== segment || /[\u0000-\u001f\u007f]/.test(segment))) reject('OOXML_PATH_INVALID');
  return Object.freeze({ directory, canonical: segments.join('/').toLocaleLowerCase('en-US'), source });
}
function resolveTarget(sourcePart, target) {
  if (typeof target !== 'string' || !target || /[\\\u0000-\u001f\u007f?#]/.test(target)
    || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.includes('%')) reject('OOXML_RELATIONSHIP_INVALID');
  const joined = target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(sourcePart), target);
  const normalized = path.posix.normalize(joined);
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) reject('OOXML_RELATIONSHIP_INVALID');
  return normalized.toLocaleLowerCase('en-US');
}
function sourcePartForRelationship(name) {
  if (name === '_rels/.rels') return '';
  const marker = '/_rels/';
  const index = name.lastIndexOf(marker);
  if (index < 0 || !name.endsWith('.rels')) reject('OOXML_RELATIONSHIP_INVALID');
  return `${name.slice(0, index)}/${name.slice(index + marker.length, -5)}`;
}
function formatFor(record) {
  const declaredMime = record.declaredMime || record.declared_mime;
  const filename = record.displayFilename || record.display_filename;
  const format = FORMATS[declaredMime];
  if (!format || typeof filename !== 'string' || filename.split('.').at(-1)?.toLowerCase() !== format.extension) {
    reject('OOXML_DECLARATION_MISMATCH');
  }
  return Object.freeze({ ...format, declaredMime });
}

class StorageRandomAccessReader extends yauzl.RandomAccessReader {
  constructor({ storage, record, head, signal, check }) {
    super(); this.storage = storage; this.record = record; this.head = head; this.signal = signal; this.check = check;
  }
  _readStreamForRange(start, end) {
    const self = this;
    return Readable.from((async function* readRanges() {
      for (let position = start; position < end;) {
        self.check();
        const last = Math.min(end - 1, position + LIMITS.maxRangeBytes - 1);
        let source;
        try {
          source = await self.storage.readRange({ objectId: self.record.objectId, storageClass: 'QUARANTINE',
            start: position, end: last, etag: self.head.etag, signal: self.signal });
          for await (const raw of source) { self.check(); yield Buffer.from(raw); }
        } catch (error) {
          if (error instanceof StructuralTransientError) throw error;
          self.check();
          throw transient(self.signal.aborted ? 'OOXML_INSPECTION_ABORTED' : 'OOXML_STORAGE_UNAVAILABLE');
        } finally { source?.destroy?.(); }
        position = last + 1;
      }
    })());
  }
}

function createXmlCollector(entryName, model, rejection) {
  const parser = new SaxesParser({ xmlns: true, position: true, fileName: entryName, defaultXMLVersion: '1.0', forceXMLVersion: true });
  let root = null;
  parser.on('doctype', () => rejection('OOXML_XML_DTD_FORBIDDEN'));
  parser.on('error', () => rejection('OOXML_XML_INVALID'));
  parser.on('opentag', node => {
    if (!root) { root = Object.freeze({ local: node.local || local(node.name), uri: node.uri || '' }); model.roots.set(entryName, root); }
    const element = node.local || local(node.name);
    if (entryName === '[Content_Types].xml') {
      if (element === 'Default') {
        const extension = attribute(node, 'Extension')?.toLowerCase(), type = attribute(node, 'ContentType');
        if (!extension || !type || model.defaults.has(extension)) rejection('OOXML_CONTENT_TYPES_INVALID');
        model.defaults.set(extension, type);
      } else if (element === 'Override') {
        const part = attribute(node, 'PartName'), type = attribute(node, 'ContentType');
        if (!part?.startsWith('/') || !type || part.includes('%')) rejection('OOXML_CONTENT_TYPES_INVALID');
        const key = part.slice(1).toLocaleLowerCase('en-US');
        if (model.overrides.has(key)) rejection('OOXML_CONTENT_TYPES_INVALID');
        model.overrides.set(key, type);
      }
    }
    if (entryName.endsWith('.rels') && element === 'Relationship') {
      const id = attribute(node, 'Id'), type = attribute(node, 'Type'), target = attribute(node, 'Target');
      const targetMode = attribute(node, 'TargetMode') || 'Internal';
      if (!id || !type || !target || !['Internal', 'External'].includes(targetMode)) rejection('OOXML_RELATIONSHIP_INVALID');
      model.relationships.push(Object.freeze({ source: sourcePartForRelationship(entryName), id, type, target, targetMode }));
    }
  });
  return parser;
}

async function consumeEntry({ zip, entry, entryName, model, limits, expandedLimit, context }) {
  const xml = entryName === '[Content_Types].xml' || entryName.endsWith('.xml') || entryName.endsWith('.rels');
  if (!entry.canDecodeFileData() || entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) reject('OOXML_ARCHIVE_UNSUPPORTED');
  if (entry.uncompressedSize > limits.maxEntryBytes || (xml && entry.uncompressedSize > limits.maxXmlBytes)) reject('OOXML_ENTRY_LIMIT_EXCEEDED');
  if (model.declaredExpanded + entry.uncompressedSize > expandedLimit) reject('OOXML_EXPANSION_LIMIT_EXCEEDED');
  model.declaredExpanded += entry.uncompressedSize;
  const stream = await zip.openReadStreamPromise(entry);
  context.active.add(stream);
  const parser = xml ? createXmlCollector(entryName, model, reject) : null;
  const decoder = xml ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }) : null;
  let actual = 0, checksum = 0, markupTail = '';
  try {
    for await (const raw of stream) {
      const bytes = Buffer.from(raw);
      for (let offset = 0; offset < bytes.length; offset += limits.processingChunkBytes) {
        context.check();
        const chunk = bytes.subarray(offset, offset + limits.processingChunkBytes);
        actual += chunk.length; model.actualExpanded += chunk.length;
        if (actual > limits.maxEntryBytes || (xml && actual > limits.maxXmlBytes) || model.actualExpanded > expandedLimit) {
          reject('OOXML_EXPANSION_LIMIT_EXCEEDED');
        }
        checksum = crc32(chunk, checksum);
        if (parser) {
          let text;
          try { text = decoder.decode(chunk, { stream: true }); } catch { reject('OOXML_XML_ENCODING_INVALID'); }
          const markup = `${markupTail}${text}`.toUpperCase();
          if (markup.includes('<!DOCTYPE')) reject('OOXML_XML_DTD_FORBIDDEN');
          if (markup.includes('<!ENTITY')) reject('OOXML_XML_ENTITY_FORBIDDEN');
          markupTail = markup.slice(-16);
          parser.write(text);
        }
        await immediate(); context.check();
      }
    }
    if (actual !== entry.uncompressedSize || (checksum >>> 0) !== (entry.crc32 >>> 0)) reject('OOXML_ARCHIVE_CORRUPT');
    if (parser) {
      let tail;
      try { tail = decoder.decode(); } catch { reject('OOXML_XML_ENCODING_INVALID'); }
      if (tail) parser.write(tail);
      parser.close();
      if (parser.xmlDecl?.encoding && !/^utf-?8$/i.test(parser.xmlDecl.encoding)) reject('OOXML_XML_ENCODING_INVALID');
    }
  } catch (error) {
    if (error instanceof StructuralRejection || error instanceof StructuralTransientError) throw error;
    reject('OOXML_ARCHIVE_CORRUPT');
  } finally { context.active.delete(stream); stream.destroy(); }
}

function validateModel(model, format) {
  const contentRoot = model.roots.get('[Content_Types].xml');
  if (!contentRoot || contentRoot.local !== 'Types' || contentRoot.uri !== CONTENT_TYPES_NS) reject('OOXML_CONTENT_TYPES_INVALID');
  if (FORBIDDEN_PART.test([...model.entries.values()].map(value => value.source).join('\n'))) reject('OOXML_ACTIVE_CONTENT_FORBIDDEN');
  for (const [name, value] of model.entries) {
    if (value.directory || name === '[content_types].xml') continue;
    const extension = value.source.includes('.') ? value.source.split('.').at(-1).toLowerCase() : '';
    const type = model.overrides.get(name) || model.defaults.get(extension);
    if (!type || FORBIDDEN_CONTENT_TYPE.test(type)) reject('OOXML_CONTENT_TYPE_FORBIDDEN');
    value.contentType = type;
  }
  const rootRels = model.roots.get('_rels/.rels');
  if (!rootRels || rootRels.local !== 'Relationships' || rootRels.uri !== RELATIONSHIPS_NS) reject('OOXML_RELATIONSHIP_INVALID');
  const office = model.relationships.filter(item => item.source === '' && OFFICE_RELATIONSHIPS.has(item.type));
  if (office.length !== 1 || office[0].targetMode !== 'Internal') reject('OOXML_MAIN_PART_INVALID');
  if (resolveTarget('', office[0].target) !== format.mainPart.toLowerCase()) reject('OOXML_DECLARATION_MISMATCH');
  const main = model.entries.get(format.mainPart.toLowerCase());
  if (!main || main.contentType !== format.mainContentType) reject('OOXML_DECLARATION_MISMATCH');
  const mainRoot = model.roots.get(main.source);
  if (!mainRoot || mainRoot.local !== format.mainRoot || mainRoot.uri !== format.mainNamespace) reject('OOXML_MAIN_PART_INVALID');
  for (const item of model.relationships) {
    if (item.targetMode === 'External') reject('OOXML_EXTERNAL_RELATIONSHIP_FORBIDDEN');
    if (FORBIDDEN_RELATIONSHIP.test(item.type)) reject('OOXML_ACTIVE_CONTENT_FORBIDDEN');
    const target = resolveTarget(item.source, item.target);
    if (!model.entries.has(target)) reject('OOXML_RELATIONSHIP_TARGET_MISSING');
  }
  for (const [name, root] of model.roots) {
    if (name.endsWith('.rels') && (root.local !== 'Relationships' || root.uri !== RELATIONSHIPS_NS)) reject('OOXML_RELATIONSHIP_INVALID');
  }
}

function createOoxmlStructuralInspector({ limits: configuredLimits } = {}) {
  const limits = validateLimits(configuredLimits);
  return Object.freeze({
    limits,
    async inspect({ record, storage, signal = null }) {
      if (!record || !storage || typeof storage.head !== 'function' || typeof storage.readRange !== 'function') {
        throw new TypeError('OOXML structural inspection dependencies are incomplete.');
      }
      const expectedSize = Number(record.observedSize ?? record.observed_size ?? record.expectedSize ?? record.expected_size);
      const expectedSha256 = record.sha256 || record.expectedSha256 || record.expected_sha256;
      if (record.expectedFileClass !== 'OOXML' || !Number.isSafeInteger(expectedSize) || expectedSize < 1
        || expectedSize > FILE_CLASSES.OOXML.maxBytes || !/^[a-f0-9]{64}$/.test(expectedSha256 || '')) {
        return Object.freeze({ status: 'REJECTED', code: 'OOXML_BINDING_INVALID' });
      }
      let format;
      try { format = formatFor(record); } catch (error) {
        return Object.freeze({ status: 'REJECTED', code: error.code || 'OOXML_DECLARATION_MISMATCH' });
      }
      const controller = new AbortController(), active = new Set();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); for (const stream of active) stream.destroy(transient('OOXML_INSPECTION_TIMEOUT')); }, limits.maxProcessingMs);
      timer.unref?.();
      const externalAbort = () => { controller.abort(); for (const stream of active) stream.destroy(transient('OOXML_INSPECTION_ABORTED')); };
      signal?.addEventListener?.('abort', externalAbort, { once: true });
      const check = () => {
        if (timedOut) throw transient('OOXML_INSPECTION_TIMEOUT');
        if (controller.signal.aborted || signal?.aborted) throw transient('OOXML_INSPECTION_ABORTED');
      };
      let zip;
      try {
        check();
        let head;
        try { head = await storage.head({ objectId: record.objectId, storageClass: 'QUARANTINE' }); }
        catch { throw transient('OOXML_STORAGE_UNAVAILABLE'); }
        if (!head || head.size !== expectedSize || head.sha256 !== expectedSha256 || typeof head.etag !== 'string' || !head.etag) {
          reject('OOXML_BINDING_INVALID');
        }
        const expandedLimit = Math.min(limits.maxExpandedBytes, expectedSize * limits.maxExpansionRatio);
        const model = { entries: new Map(), roots: new Map(), defaults: new Map(), overrides: new Map(), relationships: [],
          declaredExpanded: 0, actualExpanded: 0 };
        const context = { active, check };
        const reader = new StorageRandomAccessReader({ storage, record, head, signal: controller.signal, check });
        try { zip = await yauzl.fromRandomAccessReaderPromise(reader, expectedSize,
          { autoClose: false, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }); }
        catch (error) {
          if (error instanceof StructuralTransientError) throw error;
          reject('OOXML_ARCHIVE_INVALID');
        }
        for await (const entry of zip.eachEntry()) {
          check();
          if (model.entries.size >= limits.maxEntries) reject('OOXML_ENTRY_LIMIT_EXCEEDED');
          const validated = validateEntryName(entry.fileName, limits);
          if (model.entries.has(validated.canonical)) reject('OOXML_PATH_AMBIGUOUS');
          const value = { source: validated.source, directory: validated.directory, contentType: null };
          model.entries.set(validated.canonical, value);
          if (!validated.directory) await consumeEntry({ zip, entry, entryName: validated.source, model, limits, expandedLimit, context });
        }
        validateModel(model, format);
        return Object.freeze({ status: 'APPROVED', code: 'OOXML_STRUCTURAL_APPROVED', format: format.extension,
          entryCount: model.entries.size, expandedBytes: model.actualExpanded, contentSha256: expectedSha256 });
      } catch (error) {
        if (error instanceof StructuralTransientError) throw error;
        return Object.freeze({ status: 'REJECTED', code: error instanceof StructuralRejection ? error.code : 'OOXML_ARCHIVE_INVALID' });
      } finally {
        clearTimeout(timer); signal?.removeEventListener?.('abort', externalAbort);
        for (const stream of active) stream.destroy();
        zip?.close();
      }
    }
  });
}

module.exports = { DEFAULT_LIMITS, FORMATS, createOoxmlStructuralInspector };
