import express, { type Request as ExpressRequest, type Response as ExpressResponse, type Express } from 'express';
import config from 'stonyx/config';
import { makeArray } from '@stonyx/utils/object';

const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

export type RequestState = Record<string, unknown>;
export type RequestHandler = (req: ExpressRequest, state: RequestState) => unknown | Promise<unknown>;
export type AuthHandler = (req: ExpressRequest, state: RequestState) => number | undefined;
export type RouteHandlers = Record<string, Record<string, RequestHandler | RequestHandler[]>>;

export default class Request {
  static stateProp = '__stonyxState';

  static getState(req: ExpressRequest): RequestState {
    const { stateProp } = Request;
    const record = req as unknown as Record<string, unknown>;
    if (record[stateProp] !== undefined) return record[stateProp] as RequestState;

    record[stateProp] = {};
    return record[stateProp] as RequestState;
  }

  static sendStatusResponse(res: ExpressResponse, status: number): void {
    const statusMap = config.restServer?.statusMap ?? {};
    const message = statusMap[status] || '';

    if (message) {
      res.status(status).send(message);
    } else {
      res.sendStatus(status);
    }
  }

  expressInstance: Express;
  handlers!: RouteHandlers;
  declare auth?: AuthHandler;

  constructor() {
    const api = express();
    api.disable('x-powered-by');

    // Match routes case-sensitively unless explicitly opted out
    // (abofs/stonyx-rest-server#47). This is the sub-path half of the fix and
    // must stay in the constructor: registerCalls() materialises this router,
    // and a set applied afterwards has no effect. The parent app's setting
    // does not reach here -- see the comment in src/main.ts.
    if (config.restServer?.caseSensitiveRoutes !== false) api.set('case sensitive routing', true);

    this.expressInstance = api;
  }

  registerCalls(): void {
    const { expressInstance } = this;
    const { getState, sendStatusResponse } = Request;

    for (const [method, handlers] of Object.entries(this.handlers)) {
      if (!METHODS.has(method)) {
        console.warn(`Method "${method}" is not a valid HTTP method. Skipping...`);
        continue;
      }

      for (const [route, handler] of Object.entries(handlers)) {
        (expressInstance as unknown as Record<string, (route: string, handler: (req: ExpressRequest, res: ExpressResponse) => Promise<void>) => void>)[method](route, async (req: ExpressRequest, res: ExpressResponse) => {
          // Run auth after route matching so request.params is populated
          if (this.auth) {
            const status = this.auth(req, getState(req));
            if (status) return sendStatusResponse(res, status);
          }

          const callStack = [...makeArray(handler)] as RequestHandler[];
          const mainCall = callStack.pop()!;
          let response: unknown;

          // Run middleware
          while(callStack.length) {
            response = await callStack.shift()!.bind(this)(req, getState(req));
            if (response !== undefined) break;
          }

          if (response === undefined) response = await mainCall(req, getState(req));
          if (Number.isInteger(response)) return sendStatusResponse(res, response as number);

          // Handle redirect if set via call state object
          const state = getState(req);
          const { redirect } = state;
          if (redirect) return res.redirect(redirect as string);

          // Handle pipe if set via call state object
          const { pipe } = state;
          if (pipe) {
            const { headers, source } = pipe as { headers?: Record<string, string>; source: { pipe(res: ExpressResponse): void } };

            if (headers) for (const [key, value] of Object.entries(headers)) res.set(key, value);
            return source.pipe(res);
          }

          if (response === undefined) { res.sendStatus(200); return; }
          if (typeof response !== 'object') return sendStatusResponse(res, 500);

          res.send(response as Record<string, unknown>);
        });
      }
    }
  }
}
