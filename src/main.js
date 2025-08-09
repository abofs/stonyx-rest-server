import cors from 'cors';
import express from 'express';
import config from 'stonyx/config';
import log from 'stonyx/log';
import { forEachFileImport } from '@stonyx/utils/file';

export default class RestServer {
  constructor() {
    if (RestServer.instance) return RestServer.instance;
    RestServer.instance = this;

    this.api = new express();
    this.init();
  }
  
  async init() {
    await this.setupRouter();
    
    const { port } = config.restServer;

    // start REST server
    this.api.listen(port);
    log.title(`API Server is listening on port ${port}`);
  }

  /**
   * Iterates through the top level of api-server
   * directory, dynamically imports all sub instances
   * of express, and mounts them accordingly.
   */
  async setupRouter() {
    const { dir, origin, camelCaseRoutes } = config.restServer;

    try {
      await forEachFileImport(dir, async (routeClass, { name }) => {
        const route = `/${name}`;
        const subRoute = new routeClass();
        const { handler, auth } = subRoute;

        handler.use(express.json());

        const routeCalls = [ handler.bind(subRoute) ];

        // Assign auth callback if it exists in route handler
        if (auth) routeCalls.unshift(auth.bind(subRoute));
        
        // Set CORS headers        
        handler.use(cors({ origin }));
        
        subRoute.registerCalls();
        handler.mountpath = route;
        
        // Mount handler to main api instance
        this.api.use(route, ...routeCalls);
      }, { rawName: camelCaseRoutes !== 'true' });
    } catch (error) {
      if (config.debug) console.log(error);
      throw log.error(`Unable to dynamically configure routes from files in ${dir}`);
    }
  }
}
