import express from 'express';
import config from 'stonyx/config';
import { makeArray } from '@stonyx/utils/object';

const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

export default class Request {
  static stateProp = '__stonyxState';

  static getState(req) {
    const { stateProp } = Request;
    if (req[stateProp] !== undefined) return req[stateProp];
    
    req[stateProp] = {};
    return req[stateProp];
  }

  static sendStatusResponse(res, status) {
    const statusMap = config.restServer?.statusMap || {};
    const message = statusMap[status] || '';
  
    return message ? res.status(status).send(message) : res.sendStatus(status);
  }

  constructor() {
    const api = express();
    api.disable('x-powered-by');
    
    this.expressInstance = api;
  }

  registerCalls() {
    const { expressInstance } = this;
    const { getState, sendStatusResponse } = Request;

    for (const [method, handlers] of Object.entries(this.handlers)) {
      if (!METHODS.has(method)) {
        console.warn(`Method "${method}" is not a valid HTTP method. Skipping...`);
        continue;
      }

      for (const [route, handler] of Object.entries(handlers)) {
        expressInstance[method](route, async (req, res) => {
          // Run auth after route matching so request.params is populated
          if (this.auth) {
            const status = this.auth(req, getState(req));
            if (status) return sendStatusResponse(res, status);
          }

          const callStack = [...makeArray(handler)];
          const mainCall = callStack.pop();
          let response;

          // Run middleware
          while(callStack.length) {
            response = await callStack.shift().bind(this)(req, getState(req));
            if (response !== undefined) break;
          }

          if (response === undefined) response = await mainCall(req, getState(req));
          if (Number.isInteger(response)) return sendStatusResponse(res, response);
          
          // Handle redirect if set via call state object
          const { redirect } = getState(req);
          if (redirect) return res.redirect(redirect);

          // Handle pipe if set via call state object
          const { pipe } = getState(req);
          if (pipe) {
            const { headers, source } = pipe;

            if (headers) for (const [key, value] of Object.entries(headers)) res.set(key, value);
            return source.pipe(res);
          }

          if (response === undefined) return res.sendStatus(200);
          if (typeof response !== 'object') return sendStatusResponse(res, 500);

          res.send(response);
        });
      }
    }
  }
}