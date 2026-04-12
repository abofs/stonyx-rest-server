declare module '@stonyx/logs' {
  type ChalkColorFn = (text: string) => string;
  type ColorSetting = string | ChalkColorFn;

  interface LogOptions {
    logToFileByDefault: boolean;
    logTimestamp: boolean;
    path: string;
    prefix: string;
    suffix: string;
    filename: string;
    additionalLogs: Record<string, ColorSetting>;
    systemLogs: Record<string, ColorSetting>;
  }

  export default class Log {
    options: LogOptions;
    [key: string]: unknown;
    constructor(options?: Partial<LogOptions>);
    defineType(type: string, setting: ColorSetting, options?: Partial<LogOptions> | null): void;
    error(message: string): void;
    warn(message: string): void;
    title(message: string): void;
  }
}
