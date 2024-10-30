import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ZipStream, dateToDosDateTime } from './index.js';

const { datetime, output } = parseArgs({
  options: {
    datetime: { type: 'string', short: 't' },
    output  : { type: 'string', short: 'o' },
  }
}).values;

const zip = new ZipStream();
const writing = writeFile(output, zip);
const options = {
  lastModified: dateToDosDateTime(new Date(datetime)),
  zlib: { level: 9 },
};

await Promise.all([
  'LICENSE.txt',
  'README.md',
  'index.cjs',
  'index.js',
  'package.json',
].map(async (name) => {
  const data = await readFile(name);
  return zip.writeFile(`package/${name}`, data, options);
}));

zip.end();
await writing;
