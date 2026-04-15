import type { Request as ExpressRequest } from 'express';
import { Request } from '@stonyx/rest-server';
import type { RequestState, RouteHandlers } from '../../../src/request.js';

export default class PublicRequest extends Request {
  testProp = 'stonyx';

  handlers: RouteHandlers = {
    get: {
      '/': (_request: ExpressRequest, _state: RequestState) => {
        return { data: 'foo' };
      },

      '/success': (_request: ExpressRequest, _state: RequestState) => {
        // no return
      },

      '/url-params/:x/:y/:z': ({ params }: ExpressRequest, _state: RequestState) => {
        return params;
      },

      '/foo': [this.validationSuccessSample, (_request: ExpressRequest, state: RequestState) => {
        return { data: state };
      }],

      '/fail': [this.validationFailureSample, (_request: ExpressRequest, _state: RequestState) => {
        return { unreachable: 'response' }; // We shouldn't get here due to the forced error from validationFailureSample
      }],

      '/bind': () => {
        return { data: this.testProp };
      },

      '/bind-middleware': [this.middlewareBindTest, (_request: ExpressRequest, state: RequestState) => {
        return { data: state };
      }],
    }
  }

  validationSuccessSample(_request: ExpressRequest, state: RequestState): void {
    // validation placeholder
    state.newProp = 'bar';
  }

  validationFailureSample(): number {
    return 504; // forced error response
  }

  middlewareBindTest(_request: ExpressRequest, state: RequestState): void {
    state.testProp = this.testProp;
  }
}