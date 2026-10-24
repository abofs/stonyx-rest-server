// Mounted at /widgets. Shows how to set response headers and a status other
// than 200 while still returning a JSON body from a handler.
//
// Handlers receive express's `request`, and `request.res` is express's
// response object for that request. Anything set on it before the handler
// returns (status, headers) is kept when the returned object is sent. A
// returned integer is different: it replaces the response with that status.
//
// This route has no `auth`, to keep the sample about headers. Before you copy
// a write route, add `auth` or extend your base class (see base/api-request.ts).
import { Request, type RouteHandlers } from '@stonyx/rest-server';

export default class WidgetsRequest extends Request {
  constructor() {
    super();

    // Headers for every route in this class: middleware on `expressInstance`.
    this.expressInstance.use((_request, response, next) => {
      response.set('Cache-Control', 'no-store');
      next();
    });
  }

  handlers: RouteHandlers = {
    post: {
      '/': request => {
        const id = '7';

        // Headers and status for one route: `request.res`. Express sets it on
        // every request; its type is optional only because it is assigned at
        // runtime, hence the `!`.
        request.res!.status(201).set('Location', `/widgets/${id}`);

        return { data: { type: 'widgets', id, attributes: { name: request.body?.name } } };
      }
    }
  };
}
