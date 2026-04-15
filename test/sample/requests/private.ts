import type { Request as ExpressRequest } from 'express';
import { Request } from '@stonyx/rest-server';
import type { RequestState, RouteHandlers } from '../../../src/request.js';

export default class PrivateRequest extends Request {
  handlers: RouteHandlers = {
    get: {
      '/success': (_request: ExpressRequest, _state: RequestState) => {
        return { data: 'foo' };
      },

      '/failure': (_request: ExpressRequest, _state: RequestState) => {
        return { data: 'foo' };
      },

      '/:id': (_request: ExpressRequest, _state: RequestState) => {
        return { data: 'param-route' };
      }
    },

    // @ts-expect-error intentionally invalid method for testing runtime validation
    someInvalidMethod: (_request: ExpressRequest, _state: RequestState) => {
      return { data: 'foo' };
    }
  }

  // The auth hook handles authentication as a middleware for all handlers in this request class
  auth = (request: ExpressRequest, _state: RequestState): number | undefined => {
    if (request.path === '/failure') return 505;
    if (request.params?.id === 'restricted') return 403;
    return undefined;
  }
}