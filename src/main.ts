/*
 * Copyright 2025 Stone Costa
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import cors from 'cors';
import express, { type Express, type Request as ExpressRequest, type Response as ExpressResponse } from 'express';
import config from 'stonyx/config';
import log from 'stonyx/log';
import { forEachFileImport } from '@stonyx/utils/file';
import type { Server } from 'http';

export { default as Request } from './request.js';

export default class RestServer {
  static instance: RestServer;

  api!: Express;
  server!: Server;

  constructor() {
    if (RestServer.instance) return RestServer.instance;
    RestServer.instance = this;

    this.api = express();

    // Match routes case-sensitively unless explicitly opted out
    // (abofs/stonyx-rest-server#47). Set here, in the constructor, because the
    // router is materialised lazily on first route registration -- applying
    // this after setupRouter() would be silently ineffective.
    //
    // Note express 5's createApplication() takes zero arguments, so
    // `express({ caseSensitive: true })` is a no-op; the app setting is the
    // only mechanism that works.
    //
    // This closes the mount segment (/PUBLIC/... ). It does NOT propagate to
    // the sub-apps: settings are inherited on mount, but mountRoute() calls
    // registerCalls() before api.use(), so each child router is already built.
    // The matching set in Request's constructor is what closes sub-paths.
    if (config.restServer?.caseSensitiveRoutes !== false) this.api.set('case sensitive routing', true);
  }

  static close(): void {
    if (!RestServer.instance) throw new Error('RestServer has not been initialized yet');

    const { server } = RestServer.instance;
    server.closeAllConnections();
    server.close();
  }

  async init(): Promise<void> {
    // Self-register so log.api works even when @stonyx/rest-server is in the
    // consumer's `dependencies` (stonyx loader only merges devDependencies).
    const { logColor = 'yellow', logMethod = 'api' } = config.restServer;
    log.defineType(logMethod, logColor);

    await this.setupRouter();

    const { port } = config.restServer;

    // start REST server
    this.server = this.api.listen(port);
    log.title(`API Server is listening on port ${port}`);
  }

  async setupRouter(): Promise<void> {
    const { camelCaseRoutes, dir, enableHealthCheck } = config.restServer;
    this.setupGlobalMiddleware();

    try {
      await forEachFileImport(dir, this.mountRoute.bind(this), { rawName: !camelCaseRoutes, ignoreAccessFailure: true });

      if (enableHealthCheck) this.api.get('/health', (_req: ExpressRequest, res: ExpressResponse) => res.sendStatus(200));
    } catch (error) {
      if (config.debug) console.log(error);
      log.error(`Unable to dynamically configure routes from files in ${dir}`);
      throw new Error(`Unable to dynamically configure routes from files in ${dir}`);
    }
  }

  setupGlobalMiddleware(): void {
    const { origin, methods, trustProxy } = config.restServer;

    if (trustProxy) this.api.set('trust proxy', true);

    this.api.use([
      cors({ origin, methods }),
      express.json()
    ]);
  }

  mountRoute(routeClassUntyped: unknown, { name, options }: { name: string; options?: unknown }): void {
    const routeClass = routeClassUntyped as new (options?: unknown) => { expressInstance: Express; registerCalls(): void };
    const { api } = this;
    const classInstance = new routeClass(options);
    const route = name === 'index' ? '/' : `/${name}`;
    const { expressInstance } = classInstance;

    classInstance.registerCalls();
    expressInstance.mountpath = route;

    // Mount handler to main api instance
    api.use(route, expressInstance);
  }
}
