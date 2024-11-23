/**
 * @typedef {import('./types.d.js').TypedArray} TypedArray
 * @typedef {import('./types.d.js').ZipEntry} ZipEntry
 */

'use strict';

const { Buffer } = require('node:buffer');
const { normalize } = require('node:path/posix');
const { Transform } = require('node:stream');
const { promisify } = require('node:util');
const { crc32, deflateRaw } = require('node:zlib');

// Paste code...

module.exports = { ZipStream, dateToDosDateTime };
