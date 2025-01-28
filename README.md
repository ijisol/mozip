# Mozip

Minimal library for generating ZIP files using Promises

## Features

Mozip is for those who don't need any complex things and just want to pack a few files.

- No dependencies except Node.js built-in modules.
- Outputs as a Node.js stream.
- Provides Promise-based API.
- Uses UTF-8 file names.
- Supports store (no compression) and deflate compression methods.
- Supports setting zlib options: compression level, chunk size, etc.
- Does NOT support comments.
- Does NOT support Zip64 (files larger than or equal 4 GiB).

## Usage

``` javascript
import { writeFile } from 'node:fs/promises';
import { ZipStream, dateToDosDateTime } from 'mozip';

const zip = new ZipStream();
const writing = writeFile('example.zip', zip);

// Add a file into the stream
// Can set compression level
const data = (new TextEncoder()).encode('Hello, World!\n');
zip.writeFile('uni♥code♦.txt', data);
zip.writeFile('best-compression.txt', data, { zlib: { level: 9 } });
zip.writeFile('no-compression.txt', data, { compress: false });

// Can set modified date/time
// Also can reuse options with pre-calculated date/time
const date = new Date(2001, 0, 1);
const options = { lastModified: dateToDosDateTime(date) };
zip.writeFile('20010101/0.txt', data, { lastModified: date });
zip.writeFile('20010101/1.txt', data, options);
zip.writeFile('20010101/2.txt', data, options);

// Can handle errors that occurred before writing data into the stream
zip.writeFile('/invalid-filename', data).catch(() => {
  console.warn('The stream was not destroyed. Just ignore it.');
});

// Must be ended
zip.end();

await writing;
```

## Installation

Mozip is published in the npm registry as [mozip](https://www.npmjs.com/package/mozip). Install using your package manager (e.g. `npm install mozip`), or download a tarball or ZIP file from the [latest release](https://github.com/ijisol/mozip/releases).

## API

### `new ZipStream([validator])`

Parameters:

- `validator`: (optional) `Function` for validating file names

Public Instance Members:

- `names`: `Set` of file names in entries
- `validator(name)`: `Function` that returns a `string`, normalized and validated file name

Inherits the [`Transform` class of the `node:stream` module](https://nodejs.org/api/stream.html#class-streamtransform).

The `validator` parameter would be the `validator(name)` instance method. If the parameter is undefined, in default, the method validates only minimum restrictions from the ZIP specification and denies duplicates. For reference, the specification requires that the file name MUST NOT contain a drive or device letter, a leading slash, or a backslash (`\`).

Customizing the file name validator is for more complicated restrictions like [EPUB 3](https://www.w3.org/TR/epub-33/#sec-container-filenames). In the `validator(name)` method, `this` would be its `ZipStream` instance. So you can use `this.names` for getting file names already in entries.

### `ZipStream.prototype.writeFile(name, data[, options])`

Add a file to entries and push its data to the stream.

Parameters:

- `name`: `string`
- `data`: `TypedArray` (includes `Buffer` of the `node:buffer`) or `DataView`
- `options`: (optional) object that implements below properties:
  - `compress`: (optional) `boolean`
  - `lastModified`: (optional) `Date`, or variable that could be the `date` parameter for the `dateToDosDateTime(date)` function
  - `zlib`: (optional) object that implements the [`Options` interface of the `node:zlib` module](https://nodejs.org/api/zlib.html#class-options)

Returns a `Promise` that is resolved after compressing completed.

The `name` parameter would be a file name. It would be validated by the `validator(name)` method of the `ZipStream` instance.

The `data` parameter woud be data of the file. It become compressed by default. To store without compression, set the `compress` property in the `options` parameter to `false`.

If the `lastModified` property of the `options` parameter is undefined, it would be a moment when compressing started, according to the ZIP specification. If a `number`, it must be an unsigned 32-bit integer that represents MS-DOS date and time. Otherwise, it would be converted by the `dateToDosDateTime(date)` function.

### `ZipStream.prototype.end()`

Ends the stream of a writable side, flushing central directory headers and the end of central directory record.

Returns a `Promise` that fulfills with a `number`, total byte length of the generated file.

### `dateToDosDateTime(date)`

Parameters:

- `date`: `Date` or object that implements below methods like `Date`:
  - `getFullYear()`
  - `getMonth()`
  - `getDate()`
  - `getHours()`
  - `getMinutes()`
  - `getSeconds()`

Returns a `number`, unsigned 32-bit integer that represents [MS-DOS date and time](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-filetimetodosdatetime).

## Notes

Mozip's name is a pun; a Korean word '모집(mojip)' means collecting, and ZIP's Hangul notation is '집'.

Overall API is inspired by the excellent zipping library [yazl](https://github.com/thejoshwolfe/yazl).
