// A base class for every request that needs the same "global" middleware.
//
// There is no global request hook in @stonyx/rest-server, by design: each file
// in the requests directory is its own express sub-app. To run the same checks
// in front of many routes, put them in a class like this one and extend it.
//
// The file lives in requests/base/ because route discovery reads the requests
// directory non-recursively: subdirectories are skipped, so this class is never
// mounted as a route of its own.
import { timingSafeEqual } from 'node:crypto';
import { Request, type AuthHandler } from '@stonyx/rest-server';

export const CLIENT_VERSION_HEADER = 'x-client-version';

// Stand-ins for your own config or credential lookup.
const SAMPLE_TOKEN = Buffer.from('Bearer sample-token');

// Compare credentials in constant time, so response timing does not reveal
// how much of a guessed token is right. timingSafeEqual throws on buffers of
// different lengths, hence the length check first.
function tokenMatches(header: string | undefined): boolean {
  const given = Buffer.from(header ?? '');
  return given.length === SAMPLE_TOKEN.length && timingSafeEqual(given, SAMPLE_TOKEN);
}

async function minimumClientVersion(): Promise<number> {
  await new Promise(resolve => setTimeout(resolve, 1));
  return 3;
}

export default class ApiRequest extends Request {
  constructor() {
    super();

    // Version gate. Middleware added to `expressInstance` in the constructor
    // runs before every route of every subclass, and before `auth`. It may be
    // async (express 5 awaits it and sends a rejection to its error handler),
    // and it owns the response, so it can send any status and body. Call
    // `next()` to let the request continue.
    this.expressInstance.use(async (request, response, next) => {
      const version = Number(request.get(CLIENT_VERSION_HEADER));
      if (Number.isInteger(version) && version >= await minimumClientVersion()) return next();

      response.status(426).type('application/vnd.api+json').json({
        errors: [{
          status: '426',
          code: 'client-version',
          title: 'Upgrade Required',
          detail: `Send ${CLIENT_VERSION_HEADER} >= ${await minimumClientVersion()}`
        }]
      });
    });
  }

  // Inherited by every subclass. `auth` is synchronous: return a status code
  // to reject, or undefined to allow. Do not make it async; a returned Promise
  // is not awaited and the request fails with 500. Put async checks in the
  // constructor middleware above or in handler-array middleware.
  auth: AuthHandler = request => {
    if (!tokenMatches(request.get('authorization'))) return 401;
    return undefined;
  };
}
