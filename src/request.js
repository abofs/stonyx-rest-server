import express from 'express';
import config from 'stonyx/config';
import { makeArray } from '@stonyx/utils/object';

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
    this.expressInstance = express();
  }

  // auth hook wrapper
  authorization(req, res, next) {
    if (!this.auth) return next();

    const status = this.auth(req, Request.getState(req));
    if (status) return Request.sendStatusResponse(res, status);

    next();
  }

  registerCalls() {
    const { expressInstance } = this;
    const { getState } = Request;
    
    for (const [method, handlers] of Object.entries(this.handlers)) {
      for (const [route, handler] of Object.entries(handlers)) {
        const callStack = makeArray(handler);
        let response;

        expressInstance[method](route, async (req, res) => {
          const mainCall = callStack.pop();

          // Run middleware
          while(callStack.length) {
            response = await callStack.shift().bind(this)(req, getState(req));
            if (response !== undefined) break;
          }

          if (response === undefined) response = await mainCall(req, getState(req));
          if (Number.isInteger(response)) return res.sendStatus(response);
          if (response === undefined) return res.sendStatus(200);
          if (typeof response !== 'object') return res.sendStatus(500);

          res.send(response);
        });
      }
    }
  }
}