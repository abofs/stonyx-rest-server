import { Request, type RequestState, type RouteHandlers } from '@stonyx/rest-server';

export default class PublicRequest extends Request {
  testProp = 'stonyx';

  handlers: RouteHandlers = {
    get: {
      '/': () => {
        return { data: 'foo' };
      },

      '/success': () => {
        // no return
      },

      '/url-params/:x/:y/:z': ({ params }) => {
        return params;
      },

      '/foo': [this.validationSuccessSample, (_request, state) => {
        return { data: state };
      }],

      '/fail': [this.validationFailureSample, () => {
        return { unreachable: 'response' }; // We shouldn't get here due to the forced error from validationFailureSample
      }],

      // The final handler is called without binding `this`. Use an arrow
      // function (as here) to reach the class instance.
      '/bind': () => {
        return { data: this.testProp };
      },

      '/bind-middleware': [this.middlewareBindTest, (_request, state) => {
        return { data: state };
      }],
    }
  };

  validationSuccessSample(_request: unknown, state: RequestState): void {
    // validation placeholder
    state.newProp = 'bar';
  }

  validationFailureSample(): number {
    return 504; // forced error response
  }

  // Middleware is called with `this` bound to the request class.
  middlewareBindTest(_request: unknown, state: RequestState): void {
    state.testProp = this.testProp;
  }
}
