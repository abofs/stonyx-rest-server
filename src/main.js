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
import express from 'express';
import config from 'stonyx/config';
import log from 'stonyx/log';
import { forEachFileImport } from '@stonyx/utils/file';

export { default as Request } from './request.js';

export default class RestServer {
  constructor() {
    if (RestServer.instance) return RestServer.instance;
    RestServer.instance = this;

    this.api = new express();
  }

  static close() {
    if (!RestServer.instance) throw new Error('RestServer has not been initialized yet');

    RestServer.instance.server.close();
  }
  
  async init() {
    await this.setupRouter();
    
    const { port } = config.restServer;

    // start REST server
    this.server = this.api.listen(port);
    log.title(`API Server is listening on port ${port}`);
  }

  async setupRouter() {
    const { camelCaseRoutes, dir, enableHealthCheck } = config.restServer;
    this.setupGlobalMiddleware();

    try {
      await forEachFileImport(dir, this.mountRoute.bind(this), { rawName: !camelCaseRoutes, ignoreAccessFailure: true });

      if (enableHealthCheck) this.api.get('/health', (_req, res) => res.sendStatus(200));
    } catch (error) {
      if (config.debug) console.log(error);
      throw log.error(`Unable to dynamically configure routes from files in ${dir}`);
    }
  }

  async setupGlobalMiddleware() {
    const { origin, methods, trustProxy } = config.restServer;

    if (trustProxy) this.api.set('trust proxy', true);

    this.api.use([
      cors({ origin, methods }),
      express.json()
    ]);
  }

  async mountRoute(routeClass, { name, options }) {
    const { api } = this;
    const classInstance = new routeClass(options);
    const route = name === 'index' ? '/' : `/${name}`;
    const { expressInstance, authorization } = classInstance;
    
    const routeCalls = [ expressInstance ];

    // Assign auth callback if it exists
    if (authorization) routeCalls.unshift(authorization.bind(classInstance));

    classInstance.registerCalls();
    expressInstance.mountpath = route;
    
    // Mount handler to main api instance
    api.use(route, ...routeCalls);
  }
}
