/**
 * Minimal ambient declarations for mmd-parser (the package ships no types).
 * Only the subset MYRAA uses is declared.
 */
declare module "mmd-parser" {
  export interface ParsedPmxMetadata {
    format: string;
    [key: string]: unknown;
  }
  export interface ParsedPmx {
    metadata: ParsedPmxMetadata;
    vertices: Array<{
      position: number[];
      normal: number[];
      uv: number[];
      skinWeights: number[];
      skinIndices: number[];
    }>;
    faces: number[][];
    bones: Array<{
      name: string;
      englishName: string;
      position: number[];
      parent: number;
      flags: number;
      tail: number;
      [key: string]: unknown;
    }>;
    morphs: Array<{
      name: string;
      englishName: string;
      type: number;
      elements: Array<{ vertexIndex: number; positionOffset: number[] }>;
      [key: string]: unknown;
    }>;
    materials: Array<{
      name: string;
      englishName?: string;
      diffuse: number[];
      specular?: number[];
      shininess?: number;
      [key: string]: unknown;
    }>;
    rigidBodies?: unknown[];
    [key: string]: unknown;
  }
  export class Parser {
    constructor(options?: unknown);
    parsePmx(buffer: ArrayBuffer | Uint8Array): ParsedPmx;
    parseVmd(buffer: ArrayBuffer | Uint8Array): unknown;
    parseVpd(buffer: ArrayBuffer | Uint8Array): unknown;
    [key: string]: any;
  }
  export class CharsetEncoder {
    [key: string]: any;
  }
}
