declare module 'stonyx/config' {
  interface RestServerConfig {
    port: number;
    dir: string;
    camelCaseRoutes?: boolean;
    enableHealthCheck?: boolean;
    origin?: string | string[];
    methods?: string[];
    trustProxy?: boolean;
    statusMap?: Record<number, string>;
  }

  interface Config {
    restServer: RestServerConfig;
    debug?: boolean;
    [key: string]: unknown;
  }

  const config: Config;
  export default config;
}

declare module 'stonyx/log' {
  import type Log from '@stonyx/logs';
  const log: Log;
  export default log;
}

declare module 'stonyx' {
  export default class Stonyx {
    static initialized: boolean;
    static instance: Stonyx;
    static ready: Promise<void>;
    static get log(): unknown;
    static get config(): Record<string, unknown>;
    constructor(config: Record<string, unknown>, rootPath: string);
  }
  export function waitForModule(module: string): Promise<void>;
}

declare module 'stonyx/test-helpers' {
  export function setupIntegrationTests(hooks: { before(fn: () => Promise<void>): void }): void;
}
