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
    // skipped with a warning. Do not copy this entry.
    someInvalidMethod: {
      '/': () => {
        return { data: 'foo' };
      }
    }
  };

  // The auth hook handles authentication as a middleware for all handlers in this request class
  auth: AuthHandler = request => {
    if (request.path === '/failure') return 505;
    if (request.params?.id === 'restricted') return 403;
    return undefined;
  };
}
