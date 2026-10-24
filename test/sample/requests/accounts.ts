// Mounted at /accounts. Inherits the version gate and `auth` from ApiRequest,
// and shows async work in handler-array middleware.
import type { RequestHandler, RouteHandlers } from '@stonyx/rest-server';
import ApiRequest from './base/api-request.js';

interface Account {
  id: string;
  name: string;
}

// Stand-in for a database or remote lookup.
// A Map, not an object literal: `ACCOUNTS['constructor']` on a plain object
// finds Object.prototype and would pass the not-found check.
const ACCOUNTS = new Map<string, Account>([
  ['1', { id: '1', name: 'Ada' }]
]);

async function findAccount(id: string): Promise<Account | undefined> {
  await new Promise(resolve => setTimeout(resolve, 1));
  return ACCOUNTS.get(id);
}

export default class AccountsRequest extends ApiRequest {
  // Async middleware: awaits a lookup, then either stops the request with a
  // status or stores the result on `state` for the next function. Declared
  // before `handlers`, because class fields initialise in order and
  // `handlers` reads `this.loadAccount`.
  loadAccount: RequestHandler = async (request, state) => {
    const { id } = request.params;
    const account = typeof id === 'string' ? await findAccount(id) : undefined;
    if (!account) return 404;

    state.account = account;
    return undefined;
  };

  handlers: RouteHandlers = {
    get: {
      // Every function before the last one is middleware. Each is awaited in
      // order, with `this` bound to the request class. Returning undefined
      // continues to the next function; returning anything else stops the
      // request and is sent as the response.
      '/:id': [this.loadAccount, (_request, state) => {
        const account = state.account as Account;
        return { data: { type: 'accounts', id: account.id, attributes: { name: account.name } } };
      }]
    }
  };
}
