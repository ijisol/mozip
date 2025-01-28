/// <reference types="node" />

import type { Transform } from 'node:stream';
import type { ZlibOptions } from 'node:zlib';

export interface DateLike {
  getFullYear(): number;
  getMonth(): number;
  getDate(): number;
  getHours(): number;
  getMinutes(): number;
  getSeconds(): number;
}

export class ZipStream extends Transform {
  /**
   * File names in entries.
   */
  names: Set<string>;
  validator: (name: string) => string;

  constructor(validator?: (name: string) => string);

  /**
   * Add a file to entries and push its data to the stream.
   *
   * Returns a `Promise` that is resolved after compressing completed.
   */
  writeFile(name: string, data: ArrayBufferView | DataView, options?: {
    compress?: boolean;
    lastModified?: number | Date | DateLike;
    zlib?: ZlibOptions;
  }): Promise<void>;

  /**
   * Returns a `Promise` that fulfills with total byte length of the generated file.
   */
  end(): Promise<number>;
}

/**
 * Returns an unsigned 32-bit integer represents MS-DOS date and time.
 */
export function dateToDosDateTime(date: Date | DateLike): number;
