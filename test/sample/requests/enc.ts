import type { Request as ExpressRequest } from 'express';
import { Request } from '@stonyx/rest-server';
import type { RequestState, RouteHandlers } from '../../../src/request.js';

// Consumer-shaped fixture for abofs/stonyx-rest-server#56, shape A.
//
// The hook authorizes on `req.path` -- the field this repo's own #47/#50 work
// steered consumers toward, and the shape `test/sample/requests/private.ts`
// already uses. It is the likelier hook to exist in the field, which is why
// #56 needs it as well as the `originalUrl` shape in `enco.ts`.
//
// The route is `/:id`, and that is load-bearing rather than incidental. The
// percent-encoding bypass is EXCLUSIVE to route classes carrying a `:param`
// segment: express matches a LITERAL route against the raw, still-encoded
// path, so `GET /admin/%73ettings` was already a 404 before #56 and a
// literal-only fixture cannot express the defect at all. Measured on
// `origin/dev` @ 224f3e2: `GET /lit/%73ettings` -> 404,
// `GET /%65nc/secret` -> 404 (mount segments are raw too), while
// `GET /enc/%73ecret` -> 200 with the guarded handler running unauthenticated.
// Do NOT "simplify" this fixture to a literal route.
//
// `open` is an unguarded id and exists so an over-broad predicate -- one that
// rejects any percent-triplet, or rejects param routes wholesale -- has
// something to turn red (AC2.2). The handler echoes `id`, `path` and
// `originalUrl` so the ACs can assert WHICH value the handler received rather
// than only the status: `req.params` is decoded by express, `req.path` and
// `req.originalUrl` are not, and that asymmetry IS the defect.
export default class EncRequest extends Request {
  handlers: RouteHandlers = {
    get: {
      '/:id': (request: ExpressRequest, _state: RequestState) => {
        return {
          data: 'GUARDED-PARAM-HANDLER-RAN',
          id: request.params.id,
          path: request.path,
          originalUrl: request.originalUrl
        };
      }
    }
  };

  auth = (request: ExpressRequest, _state: RequestState): number | undefined => {
    if (request.path === '/secret') return 401;
    return undefined;
  };
}
