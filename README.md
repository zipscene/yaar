# zs-api-router

An API router, to be used by an application.


## Basic usage

`zs-api-router` does not listen for or accept connections itself---it is merely a routing layer.
It must be instantiated and used within an application that accepts express routers, like so:

```javascript
const express = require('express');
const APIRouter = require('../lib/api-router');

const app = express();
const router = new APIRouter();

app.use(router.getExpressRouter());
```


## Methods

Methods are functions defined on routers, accessed by way of interfaces (as explained below).


## Middleware


### PreMiddleware


### APIMiddleware


### PostMiddleware


## Versions

`zs-api-router` allows for routes to be namespaced by version.
At least one version is necessary to add methods to the router.
To create a version, run:

```javascript
router.version(1);
const versionTwo = router.version(2);
```

This returns a `VersionRouter`---a child router on which version-specific methods may be defined.


## Interfaces

Interfaces transform requests/responses to a common format for API calls.
They are added to `VersionRouter`s, like so:

```javascript
router.version(1).addInterface(new SomeAPIInterface());
versionTwo.addInterface(new SomeAPIInterface());
```


### HTTPRPC

HTTPRPC is an interface for RPC over HTTP.
