# stonyx-rest-server
Rest server module for Stonyx framework

## Table of Contents
1. [Overview](#overview)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Usage](#usage)
5. [API Endpoints](#api-endpoints)
7. [Authorization](#authorization)
8. [CORS](#cors)
9. [Testing](#testing)

## Overview
The stonyx-rest-server package provides a RESTful API server for the Stonyx framework. It allows you to create and manage API endpoints, handle requests and responses, and integrate with other Stonyx modules.

## Installation
To install the stonyx-rest-server package, run the following command:
```
npm install @stonyx/rest-server
```
## Configuration
The stonyx-rest-server package can be configured through the `environment.js` file. The following settings are available:

* `dir`: The directory where the API endpoints are located.
* `origin`: The origin URL for CORS.
* `camelCaseRoutes`: A boolean indicating whether to use camelCase routing.

Example:
```javascript
// environment.js
module.exports = {
  restServer: {
    dir: './api',
    origin: 'http://example.com',
    camelCaseRoutes: true
  }
};
```
## Usage
To use the stonyx-rest-server package, ensure that your project loads `stonyx-blueprint.cjs`. As long as this module
is installed, it will be auto-initialized.

## API Endpoints
API endpoints are defined in separate files within the `dir` directory. Each file should export a class that extends the `RestServer` class.

Example:
```javascript
// requests/users.js - Listens on /users
class UsersRoute extends RestServer {
  handlers = [
    get: {
      '/': (request, state) {
        //Handle GET request on /users
      },

      '/subRoute': [this.middleware1, this.middleware2, (request, state) {
        //Handle GET request on /users/subRoute after passing middleware logic
      }]
    },

    post: {
      '/': (request, state) {
        //Handle POST request on /users
      },
    }
  ];

  middleware1(request, state) {}
  middleware2(request, state) {}
}
```

Route files are directory driven. As long as the class file is placed in the configured directory (`default: ./requests`),
they will be auto-magically prepared.

```
## Authorization
The stonyx-rest-server package supports authorization through the `auth` hook. You can define an authorization function that will be called for each request:

```javascript
const RestServer = require('@stonyx/rest-server');
const restServer = new RestServer();

restServer.auth((req, res, next) => {
  // Authorization logic
});
```
## CORS
The stonyx-rest-server package supports CORS. You can configure CORS settings through the `origin` setting in the `environment.js` file.

## Testing
To test the stonyx-rest-server package, run the following command:
```
npm test
```
This will run the test suite and report any errors.

## Running the Test Suite
To run the test suite, navigate to the `test` directory and run the following command:
```
node test.js
```
This will run the test suite and report any errors.
