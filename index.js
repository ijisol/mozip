import { Buffer } from 'node:buffer';
import { normalize } from 'node:path/posix';
import { Transform } from 'node:stream';
import { promisify } from 'node:util';
import { crc32, deflateRaw } from 'node:zlib';

const DATETIME_MAX = 0xff9fbf7d; // 2107-12-31T23:59:58
const DATETIME_MIN = 0x00210000; // 1980-01-01T00:00:00
const FIXED_LFH_SIZE   = 30;
const FIXED_CDH_SIZE   = 46;
const FIXED_EOCDR_SIZE = 22;
const FLAG_UTF8 = 2 ** 11; // Set bit 11
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;
const METHOD_DEFLATE = 8;
const METHOD_STORE   = 0;
const PATTERN_DRIVE = /^[A-Za-z]:/;
const VERSION_DEFLATE = 20; // v2.0
const VERSION_STORE   = 10; // v1.0
const VERSION_MADE_BY = 63; // MS-DOS, v6.3

const deflateRawAsync = promisify(deflateRaw);

/**
 * @typedef {Int8Array|Uint8Array|Uint8ClampedArray|Int16Array|Uint16Array|Int32Array|Uint32Array|
 *           BigInt64Array|BigUint64Array|Float32Array|Float64Array} TypedArray
 */

/**
 * @typedef ZipEntry
 * @property {number} byteOffset
 * @property {number} crc
 * @property {number} flag
 * @property {number} lastModified
 * @property {number} method
 * @property {Buffer} name
 * @property {number} nameLength
 * @property {number} sizeCompressed
 * @property {number} sizeUncompressed
 * @property {number} version
 */

class ZipStream extends Transform {
  /** @type {ZipEntry[]} */
  entries = [];
  byteOffset = 0;
  names = new Set();
  promises = new Set();

  constructor() {
    super(); // No params
  }

  _flush(callback) {
    const { byteOffset, entries } = this;
    const totalEntries = entries.length;
    try {
      if (byteOffset > MAX32) {
        throw new RangeError('The size of total entries exceeds 0xFFFFFFFF bytes');
      } else if (totalEntries > MAX16) {
        throw new RangeError('The total number of files exceeds 0xFFFF');
      }
      for (let i = 0; i < totalEntries; ++i) {
        flushCentralDirHeader(this, entries[i]);
      }
      flushEndOfCentralDirRecord(this, byteOffset);
      callback(null);
    } catch (err) {
      this.emit('error', err);
    }
  }

  _transform(chunk, encoding, callback) {
    callback(null, chunk); // Pass through
  }

  /**
   * @param {string} name
   * @param {TypedArray|DataView} data
   * @param {{ compress: boolean|undefined, lastModified: number|Date|undefined, zlib }} [options]
   * @returns {Promise<void>}
   */
  async writeFile(name, data, options = {}) {
    if (typeof name !== 'string') {
      throw new TypeError('The file name is not a string');
    } else if (!ArrayBuffer.isView(data)) {
      throw new TypeError('The file data is not a TypedArray or DataView');
    }

    const { names } = this;
    name = normalizeFilename(name);
    if (names.has(name)) {
      throw new Error('Duplicated file name');
    }

    const nameBytes = Buffer.from(name, 'utf8');
    const nameLength = nameBytes.byteLength;
    const sizeUncompressed = data.byteLength;
    if (nameLength > MAX16) {
      throw new RangeError('Cannot set a file name longer than 0xFFFF bytes');
    } else if (sizeUncompressed > MAX32) {
      throw new RangeError('Cannot add a file larger than 0xFFFFFFFF bytes');
    }

    const { compress = true, lastModified = new Date(), zlib } = options;
    const dosDateTime = (typeof lastModified === 'number') ?
                        lastModified :
                        dateToDosDateTime(lastModified);
    if (!Number.isInteger(dosDateTime) ||
        (dosDateTime < DATETIME_MIN) ||
        (dosDateTime > DATETIME_MAX)) {
      throw new RangeError('Invalid date/time');
    }

    const crc = crc32(data);
    let sizeCompressed = sizeUncompressed;
    names.add(name); // Add before asynchronous task
    if (compress) {
      const compressing = deflateRawAsync(data, zlib);
      this.promises.add(compressing);
      try {
        data = await compressing;
        sizeCompressed = data.byteLength;
        if (sizeCompressed > MAX32) {
          throw new RangeError('The compressed size of file exceeds 0xFFFFFFFF bytes');
        }
      } catch (err) {
        // If this error catched, do not throw again when `end()` called.
        names.delete(name);
        this.promises.delete(compressing);
        throw err;
      }
    }

    const { byteOffset } = this;
    if (byteOffset > MAX32) {
      this.emit('error', new RangeError('The offset of the local header exceeds 0xFFFFFFFF bytes'));
    }

    /** @type {ZipEntry} */
    const entry = {
      byteOffset,
      crc,
      flag: FLAG_UTF8,
      lastModified: dosDateTime,
      method: compress ? METHOD_DEFLATE : METHOD_STORE,
      name: nameBytes,
      nameLength,
      sizeCompressed,
      sizeUncompressed,
      version: compress ? VERSION_DEFLATE: VERSION_STORE,
    };
    this.entries.push(entry);
    try {
      writeLocalFileHeaderAndData(this, entry, data);
    } catch (err) {
      this.emit('error', err);
    }
  }

  /**
   * @returns {Promise<number>} Fulfills with total byte length of the generated file
   */
  async end() {
    await Promise.all(this.promises);
    super.end();
    return this.byteOffset;
  }
}

/**
 * @param {Date|{ getFullYear: () => number,
 *                getMonth   : () => number,
 *                getDate    : () => number,
 *                getHours   : () => number,
 *                getMinutes : () => number,
 *                getSeconds : () => number }} date
 * @returns {number} Unsigned 32-bit integer represents MS-DOS date and time
 */
function dateToDosDateTime(date) {
  return ( // DO NOT use bitwise operators; overflow occurs.
    ((date.getFullYear() - 1980) * (2 ** 25)) +
    ((date.getMonth() + 1) * (2 ** 21)) +
    (date.getDate() * (2 ** 16)) +
    (date.getHours() * (2 ** 11)) +
    (date.getMinutes() * (2 ** 5)) +
    Math.trunc(date.getSeconds() / 2)
  );
}

/**
 * @param {string} name
 * @returns {string}
 */
function normalizeFilename(name) {
  name = normalize(name.replaceAll('\\', '/'));
  if (
    (name === '.') ||         // No filename
    (name === '..') ||        // Parent Directory
    name.startsWith('/') ||   // Absolute Path
    name.endsWith('/') ||     // Directory
    name.startsWith('../') || // Parent Directory
    PATTERN_DRIVE.test(name)  // Drive letter
  ) {
    throw new Error('Invalid file name');
  }
  return name;
}

/**
 * @param {ZipStream} stream
 * @param {ZipEntry} entry
 * @param {TypedArray|DataView} data
 */
function writeLocalFileHeaderAndData(stream, entry, data) {
  const { version, flag, method, lastModified, crc, sizeCompressed,
          sizeUncompressed, nameLength, name } = entry;
  const header = Buffer.allocUnsafe(FIXED_LFH_SIZE);
  header.writeUint32LE(0x04034b50      ,  0); // local file header signature
  header.writeUint16LE(version         ,  4); // version needed to extract
  header.writeUint16LE(flag            ,  6); // general perpose bit flag
  header.writeUint16LE(method          ,  8); // compression method
  header.writeUint32LE(lastModified    , 10); // last mod file date/time
  header.writeUint32LE(crc             , 14); // crc-32
  header.writeUint32LE(sizeCompressed  , 18); // compressed size
  header.writeUint32LE(sizeUncompressed, 22); // uncompressed size
  header.writeUint16LE(nameLength      , 26); // file name length
  header.writeUint16LE(0               , 28); // extra field length
  stream.write(header);
  stream.write(name);
  stream.write(data);
  stream.byteOffset += FIXED_LFH_SIZE + nameLength + sizeCompressed;
}

/**
 * @param {ZipStream} stream
 * @param {ZipEntry} entry
 */
function flushCentralDirHeader(stream, entry) {
  const { version, flag, method, lastModified, crc, sizeCompressed,
          sizeUncompressed, nameLength, name, byteOffset } = entry;
  const header = Buffer.allocUnsafe(FIXED_CDH_SIZE);
  header.writeUint32LE(0x02014b50      ,  0); // central file header signature
  header.writeUint16LE(VERSION_MADE_BY ,  4); // version made by
  header.writeUint16LE(version         ,  6); // version needed to extract
  header.writeUint16LE(flag            ,  8); // general perpose bit flag
  header.writeUint16LE(method          , 10); // compression method
  header.writeUint32LE(lastModified    , 12); // last mod file date/time
  header.writeUint32LE(crc             , 16); // crc-32
  header.writeUint32LE(sizeCompressed  , 20); // compressed size
  header.writeUint32LE(sizeUncompressed, 24); // uncompressed size
  header.writeUint16LE(nameLength      , 28); // file name length
  header.writeUint16LE(0               , 30); // extra field length
  header.writeUint16LE(0               , 32); // file comment length
  header.writeUint16LE(0               , 34); // disk number start
  header.writeUint16LE(0               , 36); // internal file attributes
  header.writeUint32LE(0               , 38); // external file attributes
  header.writeUint32LE(byteOffset      , 42); // relative offset of local header
  stream.push(header);
  stream.push(name);
  stream.byteOffset += FIXED_CDH_SIZE + nameLength;
}

/**
 * @param {ZipStream} stream
 * @param {number} centralDirOffset
 */
function flushEndOfCentralDirRecord(stream, centralDirOffset) {
  const { byteOffset, entries: { length: totalEntries } } = stream;
  const centralDirSize = byteOffset - centralDirOffset;
  if (centralDirSize > MAX32) {
    throw new RangeError('The size of the central directory exceeds 0xFFFFFFFF bytes');
  }
  const record = Buffer.allocUnsafe(FIXED_EOCDR_SIZE);
  record.writeUint32LE(0x06054b50      ,  0); // end of central dir signature
  record.writeUint16LE(0               ,  4); // number of this disk
  record.writeUint16LE(0               ,  6); // number of the disk with the start of the central dir
  record.writeUint16LE(totalEntries    ,  8); // total number of entries in the central dir on this disk
  record.writeUint16LE(totalEntries    , 10); // total number of entries in the central dir
  record.writeUint32LE(centralDirSize  , 12); // size of the central dir
  record.writeUint32LE(centralDirOffset, 16); // offset of start of central dir with respect to the starting disk number
  record.writeUint16LE(0               , 20); // .ZIP file comment length
  stream.push(record);
  stream.byteOffset += FIXED_EOCDR_SIZE;
}

export { ZipStream, dateToDosDateTime };
