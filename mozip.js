// Mozip 5.0.0 (https://github.com/ijisol/mozip)
// Copyright 2024 Lee Jisol <ijisol@naver.com>
// SPDX-License-Identifier: MIT

import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { crc32, deflateRaw } from 'node:zlib';

const MAX16 = 0xffff;
const MAX32 = 0xffffffff;
const FIXED_LFH_SIZE   = 30;
const FIXED_CDH_SIZE   = 46;
const FIXED_EOCDR_SIZE = 22;
const VERSION_MADE_BY = 63; // v6.3 & MS-DOS
const VERSION_STORE   = 10; // v1.0
const VERSION_DEFLATE = 20; // v2.0
const GPB_FLAG = 2 ** 11; // Set bit 11 (UTF-8 filename)
const METHOD_STORE   = 0;
const METHOD_DEFLATE = 8;
const LEADING_SLASHES = /^[\/\\]+/;
const DRIVE_LETTER    = /^[A-Za-z]:/;

const deflateRawAsync = promisify(deflateRaw);

async function push(stream, chunk) {
  await stream.drained;
  if (stream.destroyed) return false;
  if (!stream.push(chunk)) {
    const { promise, resolve } = Promise.withResolvers();
    stream.drained = promise;
    stream.drain = resolve;
  }
  return true;
}

function localFileHeaderFrom(entry) {
  const { name, compressedSize, uncompressedSize } = entry;
  const nameLength = name.byteLength;
  const header = Buffer.allocUnsafe(FIXED_LFH_SIZE + nameLength);
  header.writeUint32LE(0x04034b50      ,  0); // - local file header signature
  header.writeUint16LE(entry.version   ,  4); // - version needed to extract
  header.writeUint16LE(GPB_FLAG        ,  6); // - general purpose bit flag
  header.writeUint16LE(entry.method    ,  8); // - compression method
  header.writeUint32LE(entry.lastMod   , 10); // - last mod file time              2 bytes
                                              // - last mod file date              2 bytes
  header.writeUint32LE(entry.crc       , 14); // - crc-32
  header.writeUint32LE(compressedSize  , 18); // - compressed size
  header.writeUint32LE(uncompressedSize, 22); // - uncompressed size
  header.writeUint16LE(nameLength      , 26); // - file name length
  header.writeUint16LE(0               , 28); // - extra field length
  header.set(name                      , 30); // - file name
  return header;
}

function centralDirHeaderFrom(entry) {
  const { name, compressedSize, uncompressedSize } = entry;
  const nameLength = name.byteLength;
  const header = Buffer.allocUnsafe(FIXED_CDH_SIZE + nameLength);
  header.writeUint32LE(0x02014b50      ,  0); // - central file header signature
  header.writeUint16LE(VERSION_MADE_BY ,  4); // - version made by
  header.writeUint16LE(entry.version   ,  6); // - version needed to extract
  header.writeUint16LE(GPB_FLAG        ,  8); // - general purpose bit flag
  header.writeUint16LE(entry.method    , 10); // - compression method
  header.writeUint32LE(entry.lastMod   , 12); // - last mod file time              2 bytes
                                              // - last mod file date              2 bytes
  header.writeUint32LE(entry.crc       , 16); // - crc-32
  header.writeUint32LE(compressedSize  , 20); // - compressed size
  header.writeUint32LE(uncompressedSize, 24); // - uncompressed size
  header.writeUint16LE(nameLength      , 28); // - file name length
  header.writeBigUint64LE(0n           , 30); // - extra field length              2 bytes
                                              // - file comment length             2 bytes
                                              // - disk number start               2 bytes
                                              // - internal file attributes        2 bytes
  header.writeUint32LE(0               , 38); // - external file attributes
  header.writeUint32LE(entry.byteOffset, 42); // - relative offset of local header
  header.set(name                      , 46); // - file name
  return header;
}

function endOfCentralDirRecordOf(stream) {
  const { centralDirOffset, centralDirSize, totalEntries } = stream;
  const record = Buffer.allocUnsafe(FIXED_EOCDR_SIZE);
  record.writeUint32LE(0x06054b50      ,  0); // - end of central dir signature
  record.writeUint32LE(0               ,  4); // - number of this disk             2 bytes
                                              // - number of the disk with the
                                              //   start of the central directory  2 bytes
  record.writeUint16LE(totalEntries    ,  8); // - total number of entries in the
                                              //   central directory on this disk
  record.writeUint16LE(totalEntries    , 10); // - total number of entries in
                                              //   the central directory
  record.writeUint32LE(centralDirSize  , 12); // - size of the central directory
  record.writeUint32LE(centralDirOffset, 16); // - offset of start of central
                                              //   directory with respect to
                                              //   the starting disk number
  record.writeUint16LE(0               , 20); // - .ZIP file comment length
  return record;
}

export class ZipStream extends Readable {
  finalized = false;
  centralDirOffset = 0;
  centralDirSize = 0;
  totalEntries = 0;
  entries = [];
  queue = Promise.resolve();
  drained = Promise.resolve();
  drain = () => {};

  _destroy(error, callback) {
    this.drain();
    callback(error);
  }

  _read() {
    this.drain();
  }

  /**
   * Normalizes and validates a filename according to the minimum ZIP requirements.
   * Removes leading slashes, throws an error if the name starts with
   * a drive letter, and replaces backward slashes with forward slashes.
   * @param {string} name
   * @returns {string} Normalized filename
   */
  validateFilename(name) {
    name = name.replace(LEADING_SLASHES, '');
    if (DRIVE_LETTER.test(name)) {
      throw new Error('Filename cannot start with a drive letter');
    }
    return name.replaceAll('\\', '/');
  }

  /**
   * Adds a file to the ZIP archive.
   * Files are added in call order, though compression may run in parallel.
   * Rejected only before stream writing; errors during writing are emitted by the stream.
   * @param {string} name
   * @param {NodeJS.TypedArray | DataView} data
   * @param {Object} [options]
   * @param {boolean} [options.compress] Defaults to true.
   * Deflate if true, store if false.
   * @param {Date | number} [options.lastModified] Defaults to the current local time. If an
   * unsigned 32-bit integer, it is interpreted as MS-DOS date and time combined from high to low.
   * @param {import('node:zlib').ZlibOptions} [options.zlib] For deflate compression.
   * Implements the `Options` interface from `node:zlib`.
   * @returns {Promise<boolean>} Fulfills with true once the file header and data have been pushed
   * to the internal read buffer, or false if the stream is destroyed while processing.
   */
  async appendFile(name, data, options = {}) {
    const totalEntries = this.totalEntries + 1;
    if (this.destroyed) {
      throw new Error('Cannot call `appendFile()` after the stream has been destroyed');
    } else if (this.finalized) {
      throw new Error('Cannot add a file after calling `finalize()`');
    } else if (totalEntries > MAX16) {
      throw new RangeError('Cannot add a file: 65535 (0xFFFF) files have already been added');
    }

    if (typeof name !== 'string') {
      throw new TypeError('`name` must be a string');
    } else if (!ArrayBuffer.isView(data)) {
      throw new TypeError('`data` must be a TypedArray or DataView instance');
    }

    const date = options.lastModified;
    let lastMod = 0;
    if (date === undefined) {
      lastMod = dosDateTimeFrom(Date.now());
    } else if (date instanceof Date) {
      lastMod = dosDateTimeFrom(date.getTime(), date.getTimezoneOffset() * -60000);
    } else if (Number.isInteger(date) && (date >= 0) && (date <= MAX32)) {
      lastMod = date;
    } else {
      throw new TypeError(
        '`options.lastModified` must be a Date instance or an unsigned 32-bit integer'
      );
    }

    name = this.validateFilename(name);
    const nameBytes = Buffer.from(name, 'utf-8');
    const nameLength = nameBytes.byteLength;
    const uncompressedSize = data.byteLength;
    if (nameLength > MAX16) {
      throw new RangeError('Filename length in UTF-8 bytes must be less than 64 KiB');
    } else if (uncompressedSize > MAX32) {
      throw new RangeError('File size must be less than 4 GiB');
    }

    const { queue } = this;
    const { promise, resolve } = Promise.withResolvers();

    // Next two lines must run before awaiting any async work:
    this.queue = queue.then(() => promise);
    this.totalEntries = totalEntries; // Same as `++this.totalEntries`

    let { compress = true } = options;
    let compressedSize = uncompressedSize;
    let crc = 0, byteOffset = 0, centralDirOffset = 0, centralDirSize = 0;
    try {
      crc = crc32(data);
      if (compress && (uncompressedSize > 0)) {
        const compressedData = await deflateRawAsync(data, options.zlib);
        if (this.destroyed) {
          resolve();
          return false;
        }
        const size = compressedData.byteLength;
        compress = (size < uncompressedSize);
        if (compress) {
          data = compressedData;
          compressedSize = size;
        }
      }
      await queue;
      if (this.destroyed) {
        resolve();
        return false;
      }
      byteOffset = this.centralDirOffset;
      centralDirOffset = byteOffset + FIXED_LFH_SIZE + nameLength + compressedSize;
      centralDirSize = this.centralDirSize + FIXED_CDH_SIZE + nameLength;
      if (centralDirOffset > MAX32) {
        throw new RangeError(
          'Failed to add the file: the archive size before the central directory would reach or exceed 4 GiB'
        );
      } else if (centralDirSize > MAX32) {
        throw new RangeError(
          'Failed to add the file: the size of the central directory would reach or exceed 4 GiB'
        );
      }
    } catch (error) {
      --this.totalEntries;
      resolve();
      throw error;
    }

    try {
      const entry = {
        version: compress ? VERSION_DEFLATE : VERSION_STORE,
        method: compress ? METHOD_DEFLATE : METHOD_STORE,
        lastMod,
        crc,
        compressedSize,
        uncompressedSize,
        byteOffset,
        name: nameBytes,
      };
      if (
        !(await push(this, localFileHeaderFrom(entry))) ||
        ((compressedSize > 0) && !(await push(this, data)))
      ) return false;
      this.entries.push(entry);
      this.centralDirOffset = centralDirOffset;
      this.centralDirSize = centralDirSize;
      return true;
    } catch (error) {
      this.destroy(error);
      return false;
    } finally {
      resolve();
    }
  }

  /**
   * Finalizes the ZIP archive. Must be called after all files are added.
   * If every file failed to be added, the stream is destroyed
   * and an `Error` is emitted by the stream.
   * This does not wait for the stream to be completely consumed.
   * @returns {Promise<number>} Fulfills with the total byte size of
   * the archive, or `-1` if the stream is destroyed while processing.
   */
  async finalize() {
    if (this.destroyed) {
      throw new Error('Cannot call `finalize()` after the stream has been destroyed');
    } else if (this.finalized) {
      throw new Error('Cannot call `finalize()` more than once');
    } else if (this.totalEntries === 0) {
      throw new Error('Cannot finalize when no files have been added');
    }
    this.finalized = true;
    await this.queue;
    if (this.destroyed) return -1;
    try {
      if (this.totalEntries === 0) {
        throw new Error('Every file failed to be added');
      }
      for (const entry of this.entries) {
        if (!(await push(this, centralDirHeaderFrom(entry)))) return -1;
      }
      if (!(await push(this, endOfCentralDirRecordOf(this)))) return -1;
      this.push(null);
    } catch (error) {
      this.destroy(error);
      return -1;
    }
    return (this.centralDirOffset + this.centralDirSize + FIXED_EOCDR_SIZE);
  }
}

/**
 * @param {number} epochMilliseconds Since 1970-01-01T00:00:00Z
 * @param {number} [offsetMilliseconds] UTC offset, defaults to the local
 * time zone offset at `epochMilliseconds`
 * @returns {number} Unsigned 32-bit integer combining MS-DOS date and time
 * from high to low. Clamped to the MS-DOS date range of 1980 to 2107.
 */
export function dosDateTimeFrom(
  epochMilliseconds,
  offsetMilliseconds = new Date(epochMilliseconds).getTimezoneOffset() * -60000
) {
  const date = new Date(epochMilliseconds + offsetMilliseconds);
  const year = date.getUTCFullYear() - 1980;
  if (year < 0b0000000) return 0x00210000 /* 1980-01-01T00:00:00 */;
  if (year > 0b1111111) return 0xff9fbf7d /* 2107-12-31T23:59:58 */;
  return ( // Do not use bitwise operators; they overflow.
    (year * 2**25) +
    ((date.getUTCMonth() + 1) * 2**21) +
    (date.getUTCDate() * 2**16) +
    (date.getUTCHours() * 2**11) +
    (date.getUTCMinutes() * 2**5) +
    Math.trunc(date.getUTCSeconds() / 2)
  );
}

export { dosDateTimeFrom as dosDateTime };
