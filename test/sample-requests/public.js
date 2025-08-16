import { Request } from '@stonyx/rest-server';

export default class PublicRequest extends Request {
  testProp = 'stonyx';
  handlers = {
    get: {
      '/': (_request, _state) => {
        return { data: 'foo' };
      },

      '/success': (_request, _state) => {
        // no return
      },

      '/url-params/:x/:y/:z': ({ params }, _state) => {
        return params;
      },

      '/foo': [this.validationSuccessSample, (_request, state) => {
        return { data: state };
      }],

      '/fail': [this.validationFailureSample, (_request, _state) => {
        return { unreachable: 'response' }; // We shouldn't get here due to the forced error from validationFailureSample
      }],

      '/bind': () => {
        return { data: this.testProp };
      },

      '/bind-middleware': [this.middlewareBindTest, (_request, state) => {
        return { data: state };
      }],
    }
  }

  validationSuccessSample(_request, state) {
    // validation placeholder
    state.newProp = 'bar';
  }

  validationFailureSample() {
    return 504; // forced error response
  }

  middlewareBindTest(_request, state) {
    state.testProp = this.testProp;
  }
}