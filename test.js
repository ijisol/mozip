import { Buffer } from 'node:buffer';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { ZipStream, dateToDosDateTime } from './index.js';

const output = process.argv[2];
const zip = new ZipStream();
const reading = readFile(new URL(import.meta.url));
const writing = writeFile(output, zip);

const date = new Date(2000, 0, 1);
const empty = new Uint8Array(0);
let errored = 0;

zip.writeFile('deflated-empty', empty);
zip.writeFile('uni♥/code♦', empty, { lastModified: dateToDosDateTime(date) });

zip.writeFile('uni♥/code♦', empty).catch((err) => {
  if (err.message !== 'Duplicated file name') throw err;
  ++errored;
});
zip.writeFile('dir/', empty).catch((err) => {
  if (err.message !== 'Invalid file name') throw err;
  ++errored;
});
zip.writeFile('too-large', Buffer.allocUnsafe(0xffffffff + 1)).catch((err) => {
  if (err.message !== 'Cannot add a file larger than 0xFFFFFFFF bytes') throw err;
  ++errored;
});

const buffer = await reading;
zip.writeFile('deflated', buffer);
zip.writeFile('deflated-level0', buffer, { zlib: { level: 0 } });
zip.writeFile('stored', buffer, { compress: false, lastModified: date });

const bytesCounted = await zip.end();
if (errored !== 3) {
  throw new Error('Errors never catched');
}

await writing;
console.log(`Test file generated at ${output}`);

const bytesWritten = (await stat(output)).size;
if (bytesCounted !== bytesWritten) {
  throw new Error(`Wrong byteLength: counted = ${bytesCounted}, written = ${bytesWritten}`);
}

console.log(`Output size: ${bytesCounted} bytes`);
