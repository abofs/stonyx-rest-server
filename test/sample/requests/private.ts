import { Request, type AuthHandler, type RouteHandlers } from '@stonyx/rest-server';

export default class PrivateRequest extends Request {
  handlers: RouteHandlers = {
    get: {
      '/success': () => {
        return { data: 'foo' };
      },

      '/failure': () => {
        return { data: 'foo' };
      },

      '/:id': () => {
        return { data: 'param-route' };
      }
    },

    // Deliberately invalid: the test suite asserts that an unknown method is
    // skipped. Do not copy this entry.
    someInvalidMethod: {
      '/': () => {
        return { data: 'foo' };
      }
    }
  };

  // The auth hook handles authentication as a middleware for all handlers in this request class.
  // The 505 and 403 below are test fixtures, not a real auth check: see
  // base/api-request.ts for one to copy.
  auth: AuthHandler = request => {
    if (request.path === '/failure') return 505;
    if (request.params?.id === 'restricted') return 403;
    return undefined;
  };
}
