'use strict';

const { Buffer } = require('node:buffer');
const { Transform } = require('node:stream');
const { promisify } = require('node:util');
const { crc32, deflateRaw } = require('node:zlib');

// Paste code...

module.exports = { ZipStream, dateToDosDateTime };
