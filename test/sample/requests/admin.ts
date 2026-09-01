import type { Request as ExpressRequest } from 'express';
import { Request } from '@stonyx/rest-server';
import type { RequestState, RouteHandlers } from '../../../src/request.js';

// Consumer-shaped fixture for abofs/stonyx-rest-server#54.
//
// The hook authorizes on `req.originalUrl` -- the one request field express
// does NOT normalize -- because that is the shape #54 exists to protect. Do NOT
// "fix" it to compare `req.path`: rewritten that way the fixture cannot express
// the defect at all, since `req.baseUrl + req.path` is `/admin/` for BOTH
// spellings of the mount root and identical for origin-form and absolute-form
// targets alike.
//
// The hook drops the query string before comparing, and that is deliberate
// rather than incidental. `canonicalRoutes` compares the query-stripped target
// (a query string is a legitimately variable part of the request target, so
// rejecting on it would 404 every `?`-carrying request), which means the module
// permits `GET /admin?x=1` through to this hook. Measured on `origin/dev` AND on
// this branch: with a hook that compares the RAW `originalUrl` including the
// query, `GET /admin?x=1` reaches the guarded handler unauthenticated either
// way -- the fix neither opens nor closes it. That residual belongs to the
// consumer's comparison, not to this module, so the fixture models the
// correctly-written hook and AC1 asserts the module still delivers
// `GET /admin?x=1` to it (401). See "scope limits" in the #54 PR body.
const PROTECTED = new Set(['/admin', '/admin/settings']);

export default class AdminRequest extends Request {
  handlers: RouteHandlers = {
    get: {
      '/': (_request: ExpressRequest, _state: RequestState) => {
        return { data: 'GUARDED-ROOT-HANDLER-RAN' };
      },

      '/settings': (_request: ExpressRequest, _state: RequestState) => {
        return { data: 'GUARDED-SETTINGS-HANDLER-RAN' };
      },

      // Registered WITH a literal trailing slash on purpose. The canonical form
      // of this route legitimately carries the slash, so a blanket
      // "the target must not end in /" rule would 404 a correctly-spelled
      // request. AC1.10 asserts it still matches at its registered spelling.
      '/legacy/': (_request: ExpressRequest, _state: RequestState) => {
        return { data: 'LEGACY-HANDLER-RAN' };
      }
    }
  };

  auth = (request: ExpressRequest, _state: RequestState): number | undefined => {
    if (PROTECTED.has(request.originalUrl.split('?')[0]!)) return 401;
    return undefined;
  };
}
