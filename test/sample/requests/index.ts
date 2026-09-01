import type { Request as ExpressRequest } from 'express';
import { Request } from '@stonyx/rest-server';
import type { RequestState, RouteHandlers } from '../../../src/request.js';

// Index-mounted route class, for abofs/stonyx-rest-server#54 AC1.12.
//
// `RestServer.mountRoute()` maps a class named `index` to mount path `/`
// (src/main.ts), and that is the ONE mount shape where `req.baseUrl` is the
// empty string. It exists so the `&& req.baseUrl` conjunct in
// `shouldRejectTarget()`'s canonical expression has a regression guard:
//
//   const canonical = req.path === '/' && req.baseUrl ? req.baseUrl : req.baseUrl + req.path;
//
// Drop the conjunct and `canonical` becomes `''` for `GET /` while the raw
// target is `'/'`, so the predicate rejects the APPLICATION ROOT. Measured on
// this branch before this fixture existed: shipped `GET /` -> 200, conjunct
// dropped -> 404, and the suite stayed 34 pass / 0 fail either way. A total
// root outage that nothing could see.
//
// Deliberately has NO auth hook and exactly one route: its whole job is to make
// the empty-`baseUrl` mount shape reachable from the integration tier.
export default class IndexRequest extends Request {
  handlers: RouteHandlers = {
    get: {
      '/': (_request: ExpressRequest, _state: RequestState) => {
        return { data: 'INDEX-ROOT-RAN' };
      }
    }
  };
}
