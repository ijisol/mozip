# Mozip

Minimal library for generating ZIP files using Promises

## Features

Mozip is for those who don't need any complex things and just want to pack a few files.

- No dependencies except Node.js built-in modules.
- Outputs as a Node.js stream.
- Provides Promise-based API.
- Supports UTF-8 file names.
- Supports store (no compression) and deflate compression methods.
- Supports setting zlib options: compression level, chunk size, etc.
- Does NOT support comments.
- Does NOT support Zip64 (files larger than or equal 4 GiB).

## Usage

``` javascript
import { Buffer } from 'node:buffer';
import { writeFile } from 'node:fs/promises';
import { ZipStream, dateToDosDateTime } from 'mozip';

const zip = new ZipStream();
const writing = writeFile('example.zip', zip);
const data = Buffer.from('Hello, World!\n', 'utf8');

// Write data
zip.writeFile('uni♥code♦.txt', data);

// Can set compression level
zip.writeFile('best-compression.txt', data, { zlib: { level: 9 } });
zip.writeFile('no-compression.txt', data, { compress: false });

// Can set modified date/time
const date = new Date(2001, 0, 1);
zip.writeFile('20010101/0.txt', data, { lastModified: date });

// Can reuse options with pre-calculated date/time
const options = { lastModified: dateToDosDateTime(date) };
zip.writeFile('20010101/1.txt', data, options);
zip.writeFile('20010101/2.txt', data, options);

// Can handle errors that occurred before writing data into stream
await zip.writeFile('../invalid-filename/', data).catch(() => {
  console.warn('The stream was not destroyed. Just ignore it.');
});

// Must be ended
zip.end();
await writing;
```

## Install

Mozip is published in the npm registry as [mozip]. Install using the npm CLI (`npm install mozip`), or download a tarball or a ZIP file (created by this, of course) from [the latest release].

[mozip]: https://www.npmjs.com/package/mozip
[the latest release]: https://github.com/ijisol/mozip/releases

## API

### `new ZipStream()`

The `ZipStream` class inherits the [`Transform`] class of the `node:stream` module. All parameters when constructing are ignored.

[`Transform`]: https://nodejs.org/api/stream.html#class-streamtransform

### `ZipStream.prototype.writeFile(name, data[, options])`

Add a file to entries and push its data to the stream. Duplicated file names in entries are not allowed.

Parameters:

- `name`: `string`
- `data`: `TypedArray` (includes `Buffer` of the `node:buffer`) or `DataView`
- `options`: (optional) any object that implements below properties:
  - `compress`: (optional) `boolean`
  - `lastModified`: (optional) `Date` or `number`
  - `zlib`: (optional) any object that implements the [`Options`] interface of the `node:zlib`

[`Options`]: https://nodejs.org/api/zlib.html#class-options

Returns a `Promise` that resolves after compressing completed and data pushed to the stream.

Data become compressed by default. To store without compression, set `compress` in `options` to `false`.

If `lastModified` in `options` is not set, it becomes when compressing started, according to the ZIP specification.

If `lastModified` is a `number`, it must be an unsigned 32-bit integer that represents MS-DOS date and time. The `dateToDosDateTime(date)` function is an utility for this.

### `ZipStream.prototype.end()`

Ends the stream of a writable side, flushing central directory headers and the end of central directory record.

Returns a `Promise` that fulfills with a `number`, total byte length of the generated file.

### `dateToDosDateTime(date)`

Parameters:

- `date`: `Date` or any object that implements below methods:
  - `getFullYear()`
  - `getMonth()`
  - `getDate()`
  - `getHours()`
  - `getMinutes()`
  - `getSeconds()`

Returns a `number`, unsigned 32-bit integer that represents [MS-DOS date and time].

[MS-DOS date and time]: https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-filetimetodosdatetime

## Notes

Mozip's name is a pun; a Korean word '모집(mojip)' means collecting, and ZIP's Hangul notation is '집'.

Overall API is inspired by the excellent zipping library [yazl] made by Josh Wolfe.

[yazl]: https://github.com/thejoshwolfe/yazl
