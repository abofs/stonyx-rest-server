import { Request } from '@stonyx/rest-server';

export default class PrivateRequest extends Request {
  handlers = {
    get: {
      '/success': (_request, _state) => {
        return { data: 'foo' };
      },

      '/failure': (_request, _state) => {
        return { data: 'foo' };
      },

      '/:id': (_request, _state) => {
        return { data: 'param-route' };
      }
    },

    someInvalidMethod: (_request, _state) => {
      return { data: 'foo' };
    }
  }

  // The auth hook handles authentication as a middleware for all handlers in this request class
  auth(request, _state) {
    if (request.path === '/failure') return 505;
    if (request.params?.id === 'restricted') return 403;
  }
}