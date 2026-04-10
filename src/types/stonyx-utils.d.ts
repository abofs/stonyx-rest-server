declare module '@stonyx/utils/file' {
  interface ReadFileOptions {
    json?: boolean;
    missingFileCallback?: (filePath: string) => string | Record<string, unknown>;
  }
  interface FileImportMeta {
    name: string;
    stats: import('fs').Stats;
    path: string;
    options?: unknown;
  }
  interface ForEachFileImportOptions {
    ignoreAccessFailure?: boolean;
    recursive?: boolean;
    recursiveNaming?: boolean;
    rawName?: boolean;
    namePrefix?: string;
    fullExport?: boolean;
  }
  export function readFile(filePath: string, options: ReadFileOptions & { json: true }): Promise<Record<string, unknown>>;
  export function readFile(filePath: string, options?: ReadFileOptions): Promise<string>;
  export function forEachFileImport(dir: string, callback: (output: unknown, meta: FileImportMeta) => void | Promise<void>, options?: ForEachFileImportOptions): Promise<void>;
  export function createFile(filePath: string, data: string | Record<string, unknown>): Promise<void>;
  export function createDirectory(dir: string): Promise<void>;
  export function copyFile(sourcePath: string, targetPath: string): Promise<boolean>;
  export function fileExists(filePath: string): Promise<boolean>;
}

declare module '@stonyx/utils/object' {
  export function mergeObject<T extends Record<string, unknown>>(target: T, source: Partial<T>): T;
  export function makeArray<T>(value: T | T[]): T[];
}

declare module '@stonyx/utils/string' {
  export function kebabCaseToCamelCase(str: string): string;
}

declare module '@stonyx/utils/prompt' {
  export function confirm(question: string): Promise<boolean>;
  export function prompt(question: string): Promise<string>;
}
