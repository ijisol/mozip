/// <reference types="node" />

import type { ZlibOptions } from 'node:zlib';

export interface DateLike {
  getFullYear(): number;
  getMonth(): number;
  getDate(): number;
  getHours(): number;
  getMinutes(): number;
  getSeconds(): number;
}

export class ZipStream {
  constructor(validator?: (name: string) => string);

  /**
   * Add a file to entries and push its data to the stream.
   */
  writeFile(name: string, data: ArrayBufferView | DataView, options?: {
    compress?: boolean;
    lastModified?: number | Date | DateLike;
    zlib?: ZlibOptions;
  }): Promise<void>;

  /**
   * Returns a Promise fulfills with total byte length of the generated file.
   */
  end(): Promise<number>;
}

/**
 * Returns an unsigned 32-bit integer represents MS-DOS date and time.
 */
export function dateToDosDateTime(date: Date | DateLike): number;
