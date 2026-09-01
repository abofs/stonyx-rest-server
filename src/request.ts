import express, { type Request as ExpressRequest, type Response as ExpressResponse, type NextFunction, type Express } from 'express';
import config from 'stonyx/config';
import { makeArray } from '@stonyx/utils/object';
import applyRouteMatching, { shouldRejectTarget } from './route-matching.js';

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

    // Applies BOTH route-matching SETTINGS: case sensitive routing
    // (abofs/stonyx-rest-server#47) and strict routing (#50). For #47 this
    // call closes sub-paths (/public/SUCCESS) and the parent's call closes the
    // mount segment; for #50 THIS call closes the entire trailing-slash
    // authorization bypass on its own, and the parent's call has no security
    // role. Must stay in the constructor: registerCalls() materializes this
    // router, and a set applied afterwards has no effect. The parent app's
    // setting does not reach here -- see src/route-matching.ts.
    //
    // The third route-matching control, `canonicalRoutes` (#54), is NOT applied
    // here and must not be moved here. It is not an express setting, and its
    // timing contract is the opposite of these two: it is read PER REQUEST
    // inside the handler closure in registerCalls() below, via
    // shouldRejectTarget(). These two are constructor-timed because a late
    // `set` is silently ineffective; that hazard does not exist for #54, and
    // reading it per request is what lets the unit AC flip the flag between
    // probes.
    applyRouteMatching(api);

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
        (expressInstance as unknown as Record<string, (route: string, handler: (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => Promise<void>) => void>)[method](route, async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
          // abofs/stonyx-rest-server#54 -- reject a request whose RAW target is
          // not the canonical path express matched, closing two authorization
          // bypasses against hooks that authorize on `req.originalUrl`: the
          // mount-root trailing slash and the absolute-form request target.
          //
          // Three properties of this line are load-bearing. Each is named with
          // the ONE assertion that turns red when it is removed -- assertion
          // numbers in `test/integration/rest-server-test.ts` AC1, so the claim
          // is checkable rather than a promise that coverage exists somewhere:
          //
          //   1. It runs OUTSIDE `if (this.auth)`. Gating it on the hook would
          //      leave `GET /public/` at 200 and make a security control depend
          //      on an unrelated consumer choice. Killed by AC1.6, which probes
          //      a route class with no hook.
          //   2. It runs BEFORE that block, not merely outside it. This is a
          //      SEPARATE property from 1 and needs its own probe: AC1.6 is on
          //      a hookless class, so it stays green if this line is merely
          //      moved BELOW the block. Measured with it moved: the suite was
          //      34 pass / 0 fail while `GET http://HOST/private/failure`
          //      answered 505 -- the consumer's hook status, which is the same
          //      oracle class as 3, and the hook itself ran on a request this
          //      module was about to reject. Killed by AC1.11.
          //   3. It rejects with `next('router')`, NOT sendStatusResponse() or
          //      res.sendStatus(404). Measured: sendStatus returns
          //      `text/plain "Not Found"` while a genuine miss returns
          //      `text/html <pre>Cannot GET ...</pre>` -- a working ORACLE
          //      telling an attacker the route exists but was spelled wrong.
          //      next('router') exits this sub-app's router into finalhandler
          //      and is shape-identical to a real miss (same status, same
          //      Content-Type, same CSP header). Routing it through
          //      sendStatusResponse() would additionally re-introduce the
          //      oracle for any consumer who sets a 404 in `statusMap`.
          //      Killed by AC1.5.
          //
          // Properties 1 and 2 were previously stated here as a single item
          // asserted to have "its own red-able assertion". It did not: only
          // half of it was covered. Do not re-merge them.
          if (shouldRejectTarget(req)) return next('router');

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
