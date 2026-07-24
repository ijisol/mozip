# Mozip

Minimal, single-file library for generating ZIP archives with Node.js streams and a Promise-based API

- Zero dependencies except Node.js built-in modules
- Implements a Node.js `Readable` stream
- Supported compression methods: Store (no compression), Deflate
- Configurable with zlib options (level, chunk size, etc.) for Deflate
- UTF-8 filenames enforced

Not supported:

- ZIP64 (files 4 GiB or larger, etc.)
- Splitting or spanning archives
- Configuring file attributes
- Comments

## Usage

``` javascript
import { Buffer } from 'node:buffer';
import { writeFile } from 'node:fs/promises';
import { constants } from 'node:zlib';
import { ZipStream, dosDateTimeFrom } from 'mozip';

const zip = new ZipStream();
const finished = writeFile('example.zip', zip).catch((error) => {
  console.error(error); // Stream or file writing error
});

// Files are added in `appendFile()` call order, though compression may run in parallel.
// No need to await this unless parallel task management is needed.
await zip.appendFile('heavy/file', Buffer.alloc(2**31 - 1));

const data = Buffer.from('Hello, world!\n'.repeat(2**16));
zip.appendFile('compressed', data);
zip.appendFile('stored', data, { compress: false });
zip.appendFile('compressed/best', data, {
  zlib: { level: constants.Z_BEST_COMPRESSION },
});

const date = new Date('2000-01-02T01:23:45.678Z');
zip.appendFile('timezone/local', data, { lastModified: date });
zip.appendFile('timezone/UTC+9', data, {
  lastModified: dosDateTimeFrom(date.getTime(), 9 * 60 * 60 * 1000),
});

// Rejects if a filename starts with a drive letter.
zip.appendFile('C:\\file', data).catch(() => {
  console.log('Skipped; the stream is still alive.');
});

// Must call `finalize()` after all files are added.
// No need to await this unless the total size is needed.
zip.finalize().then((byteLength) => {
  if (byteLength < 0) return; // Failed to finalize
  console.log(`Total size of the ZIP archive: ${byteLength} bytes`);
});

await finished;
```

## Install

Install [mozip](https://www.npmjs.com/package/mozip) from the npm registry with your preferred package manager, such as:

``` shell
npm install mozip
```

Then import the package:

``` javascript
import { ZipStream, dosDateTimeFrom } from 'mozip';
```

Alternatively, download [mozip.js](https://github.com/ijisol/mozip/blob/latest/mozip.js) from the latest release, then import it directly:

``` javascript
import { ZipStream, dosDateTimeFrom } from './mozip.js';
```

In Node.js, v22.2 or later is required. Using the package in CommonJS modules requires v22.10 or later.

Also compatible with any runtime providing:

- `Buffer` from `node:buffer`
- `Readable` from `node:stream`
- `promisify()` from `node:util`
- `crc32()`, `deflateRaw()` from `node:zlib`
- Global `Promise.withResolvers()`

## API

### `new ZipStream([options])`

- Extends: [`Readable`](https://nodejs.org/api/stream.html#class-streamreadable) from `node:stream`
- `[options]`: `{Object}` Passed to the [`Readable` constructor](https://nodejs.org/api/stream.html#new-streamreadableoptions).

Can be piped or passed to any consumer that accepts a `Readable`, such as `writeFile()` from `node:fs/promises`.

Stream errors are always emitted by the stream itself, never rejected within instance method calls.

Instance fields not documented here should not be considered public API.

### `ZipStream#validateFilename(name)`

- `name`: `{string}` Filename
- Returns: `{string}` Normalized filename

Normalizes and validates a filename according to the minimum ZIP requirements.

Removes leading slashes, throws an error if the name starts with a drive letter, and replaces backward slashes with forward slashes.

Can be overridden to enforce stricter rules, such as [EPUB restrictions](https://www.w3.org/TR/epub-33/#sec-container-filenames).

### `ZipStream#appendFile(name, data[, options])`

- `name`: `{string}` Filename
- `data`: `{TypedArray | DataView}` File data
- `[options]`: `{Object}`
  - `[compress]`: `{boolean}` Deflate if true, store if false. Defaults to true.
  - `[lastModified]`: `{Date | number}` Last modified date/time of the file, defaults to the current local time. If an unsigned 32-bit integer, it is interpreted as MS-DOS date and time combined from high to low, as produced by `dosDateTimeFrom()`.
  - `[zlib]`: `{node:zlib.Options}` Options for deflate compression. Implements the [`Options`](https://nodejs.org/api/zlib.html#class-options) interface from `node:zlib`.
- Returns: `{Promise<boolean>}` Fulfills with true once the file header and data have been pushed to the internal read buffer, or false if the stream is destroyed while processing.

Adds a file to the ZIP archive. Files are added in call order, though compression may run in parallel.

Do not modify the contents of `data` after passing it; the view is compressed or written directly without being copied.

Even when `options.compress` is true (the default), the file is stored if compressing did not reduce its size.

To set a specific time zone for `options.lastModified`, pass a value produced by `dosDateTimeFrom()`. By default, the local offset at the timestamp is used.

Rejected only before stream writing with:

- `Error` if the stream is already destroyed, or `finalize()` was already called.
- `RangeError` if the archive already contains the maximum of 0xFFFF files.
- `TypeError` if any parameter has an invalid type.
- `RangeError` if the filename length exceeds 0xFFFF bytes in UTF-8 encoding, or the file size exceeds 0xFFFFFFFF bytes.
- `RangeError` if the offset of the start of the central directory would exceed 0xFFFFFFFF, or the size of the central directory would exceed 0xFFFFFFFF bytes.

Errors during writing are emitted by the stream.

### `ZipStream#finalize()`

- Returns: `{Promise<number>}` Fulfills with the total byte size of the archive, or `-1` if the stream is destroyed while processing.

Finalizes the ZIP archive by writing the central directory and ending the stream. Must be called after all files are added.

Rejected with an `Error` if the stream is already destroyed, `finalize()` was already called, or no files were added.

If every file failed to be added, the stream is destroyed and an `Error` is emitted by the stream.

This does not wait for the stream to be completely consumed. To await complete stream consumption, `finished()` from `node:stream/promises` may be useful:

``` javascript
import { finished } from 'node:stream/promises';
import { ZipStream } from 'mozip';

/* ... */

const zip = new ZipStream();
const consumed = finished(zip);

/* Pipe the stream, call `zip.appendFile()` more than once, etc. */

zip.finalize();
try {
  await consumed;
  console.log('Stream consumed');
} catch (error) {
  console.error('Stream errored', error);
}
```

### `dosDateTimeFrom(epochMilliseconds[, offsetMilliseconds])`

Alias: `dosDateTime()`

- `epochMilliseconds`: `{number}` Milliseconds since the epoch (1970-01-01T00:00:00Z)
- `[offsetMilliseconds]`: `{number}` UTC offset in milliseconds, defaults to the local time zone offset at `epochMilliseconds`
- Returns: `{number}` Unsigned 32-bit integer combining [MS-DOS date and time](https://learn.microsoft.com/en-us/windows/win32/sysinfo/ms-dos-date-and-time) from high to low. Clamped to the MS-DOS date range of 1980 to 2107.

Used with the `options.lastModified` parameter of `ZipStream#appendFile()`. Useful for applying the same timestamp to multiple files, or setting a specific time zone.

Note: The sign of `Date#getTimezoneOffset()` is opposite to that of the UTC offset.

## License

[MIT](LICENSE)

## Notes

The name Mozip is a pun; the Korean word 모집 (mo-jib) means gathering or collecting, and ZIP is written 집 in Hangul.
