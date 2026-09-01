import type { Request as ExpressRequest } from 'express';
import { Request } from '@stonyx/rest-server';
import type { RequestState, RouteHandlers } from '../../../src/request.js';

// Consumer-shaped fixture for abofs/stonyx-rest-server#56, shape B.
//
// Identical to `enc.ts` except that the hook authorizes on the query-stripped
// `req.originalUrl`, modelled verbatim on `test/sample/requests/admin.ts` --
// the correctly-written `originalUrl` hook #54 shipped as the worked example.
// Stripping the query is deliberate and is #54's consumer contract; a hook that
// does not strip it has a separate, disclosed residual that is not #56's.
//
// Both shapes are needed and neither subsumes the other. `req.path` and
// `req.originalUrl` are BOTH raw -- express decodes only `req.params` -- so no
// spelling defeats one and not the other, and that symmetry is itself the
// finding: the fix has to sit ahead of both fields rather than steering
// consumers from one to the other. Measured on `origin/dev` @ 224f3e2:
// `GET /enco/secret` -> 401, `GET /enco/%73ecret` -> 200 with the guarded
// handler running unauthenticated.
const PROTECTED = new Set(['/enco/secret']);

export default class EncoRequest extends Request {
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
    if (PROTECTED.has(request.originalUrl.split('?')[0])) return 401;
    return undefined;
  };
}
