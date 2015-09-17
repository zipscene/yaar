# zs-api-router

An API router to be used by an express application.


## Basic usage

`zs-api-router` does not listen for or accept connections itself---it is merely a routing layer.
It must be instantiated and used within an application that accepts express routers, like so:

```javascript
const express = require('express');
const APIRouter = require('zs-api-router');

const app = express();
const router = new APIRouter();

app.use(router.getExpressRouter());
```


## Versions

`zs-api-router` allows for routes to be namespaced by version.
To create a version, run:

```javascript
router.version(1);
const versionTwo = router.version(2);
```

This returns a `VersionRouter`---a child router on which version-specific methods may be defined.


## Methods

Methods are functions defined on routers, accessed via interfaces (as explained below).
They are registered on the router, with the method name defined in an options object.
Method names may be semantically sectioned by `.`, which can be utilized or ignored by specific interfaces.
See the documentation on [APICallRegistrar#register](lib/api-call-registrar.js) for an in-depth explanation of all accepted options.

```javascript
router.register({
	method: 'foo.bar'
}, () => {
	return 'yay!';
});

// => { response: 'yay!' }
```

As shown above, a return value in a method will be used as a response.

Errors are sent in a similar fashion.

```javascript
router.register({
	method: 'foo'
}, () => {
	throw new Error('no!');
});

// => { error: { code: 'internal_error', message: 'no!' } }
```

`XError` instances are explicitly supported, for convenience:

```javascript
router.register({
	method: 'not_modified'
}, () => {
	throw new XError(XError.NOT_MODIFIED, 'I\'m afraid I can\'t do that.');
});

// => { error: { code: 'not_modified', message: 'I\'m afraid I can\'t do that.' } }
```

Methods may also be defined on specific `VersionRouter` instances, rather than the main router.
Such methods will only be available under the relevant version namespace.
`VersionRouter#register` functions the same as `APIRouter#register`.


### Versions

Methods may be defined to adhere to specific versions.
The supported syntax is as follows:

```javascript
router.register({
	method: 'everything.ever',
	versions: [ '-1', 3, '4-5', '7', '9-' ]
}, () => {
	return true;
});
```

This `versions` option accepts an array with any combination of the following valid items:

- a number, referencing a specific version
- a string, referencing a specific version
- a range terminated on both ends, referencing a range of versions
- a range terminated on only one end, referencing a range of versions


### Promises

These methods support promises as well.
Returning a `Promise` from a method will result in a success response if the promise resolves,
and an error response if the promise rejects.

```javascript
router.register({
	method: 'resolve'
}, () => {
	return new Promise((resolve) => {
		setImmediate(() => resolve({ foo: 'bar' }));
	});
});

// => { result: { foo: 'bar' } }
```

```javascript
router.register({
	method: 'limit_exceeded'
}, () => {
	return new Promise((resolve, reject) => {
		setImmediate(() => reject(new XError(XError.LIMIT_EXCEEDED, 'STOP DOING THAT!')));
	});
});

// => { error: { code: 'limit_exceeded', message: 'STOP DOING THAT!' } }
```


## Middleware


### APIMiddleware

When you register a method on a router, you are really just defining a single middleware function.
Multiple such middleware methods may be defined as follows:

```javascript
router.register(
	{ method: 'foo' },
	(ctx) => { console.log('This route was just hit.'); },
	(ctx) => { ctx.someArray = []; },
	someOtherMiddleware,
	(ctx) => { ctx.someArray.push('foo'); },
	(ctx) => { ctx.someArray.push('bar'); },
	yetAnotherMiddleware,
	...
);
```

The `ctx` argument is made up of the following:

- `ctx.req`: The express request.
- `ctx.res`: The express response.
- `ctx.method`: The name of the method.
- `ctx.params`: Parameters to the called method.
- `ctx.version`: The version of the router on which the method was called.
- `ctx.result`: The result of the method, if one has been set.
- `ctx.error`: The error of the method, if one has been set.
- `ctx.extraErrors`: List of errors that have occurred in PostMiddleware functions.

`ctx` is shared across middleware functions in the same pipeline, and may thus be used for state:

```javascript
router.register({
	method: 'foo'
}, (ctx) => {
	ctx.blah = 'blah';
}, (ctx) => {
	return ctx.blah;
});
```


### PreMiddleware

PreMiddleware runs before relevant methods.

```javascript
router.registerPreMiddleware({}, (ctx) => {
	ctx.someProp = 'foo';
});
```

PreMiddleware may also be defined per-version, by adding them to a `versionRouter` instead of the main router.


### PostMiddleware

PostMiddleware runs before relevant methods.
Errors in PostMiddleware functions are ignored.

```javascript
router.registerPostMiddleware({}, (ctx) => {
	console.log(`The method ${ctx.method} was just hit.`);
});
```

PostMiddleware may also be defined per-version, by adding them to a `versionRouter` instead of the main router.


## Interfaces

Interfaces transform requests/responses to a common format for API calls.
They are added to `VersionRouter`s, like so:

```javascript
router.version(1).addInterface(new SomeAPIInterface());
versionTwo.addInterface(new SomeAPIInterface());
```


### HTTPRPC

HTTPRPC is an interface for RPC over HTTP.
This exposes the methods as routes accessible over HTTP.
All methods are exposed as POST requests, with all method parameters passed in the POST body.
All methods respond with a status code of `200`, whether the responses contain errors or not.
Methods will respond with a `500` status code if the requested endpoint is not found.

Consider the following method:

```javascript
router.register({
	method: 'foo'
}, () => {
	return 'yay!';
});
```

This would be accessible via HTTP requests to `/v1/rpc/foo`, for example.

The HTTPRPC interface translates methods segmented by `.` into `/` in the HTTP endpoints.
The following method would be accessible at `/v1/rpc/foo/bar`:

```javascript
router.register({
	method: 'foo.bar'
}, () => {
	return 'yay!';
});
```

See the [HTTPRPCInterface](lib/http-rpc-interface.js) file for more information.
