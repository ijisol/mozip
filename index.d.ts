/// <reference types="node" />

import type { ZlibOptions } from 'node:zlib';

export class ZipStream {
  writeFile(name: string, data: ArrayBufferView | DataView, options?: {
    compress?: boolean;
    lastModified?: number | Date | {
      getFullYear(): number;
      getMonth(): number;
      getDate(): number;
      getHours(): number;
      getMinutes(): number;
      getSeconds(): number;
    };
    zlib: ZlibOptions;
  }): Promise<void>;

  /**
   * Returns a Promise fulfills with total byte length of the generated file.
   */
  end(): Promise<number>;
}

/**
 * Returns an unsigned 32-bit integer represents MS-DOS date and time.
 */
export function dateToDosDateTime(date: Date | {
  getFullYear(): number;
  getMonth(): number;
  getDate(): number;
  getHours(): number;
  getMinutes(): number;
  getSeconds(): number;
}): number;
