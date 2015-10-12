const supertest = require('supertest');
const express = require('express');
const _ = require('lodash');
const { expect } = require('chai');
const XError = require('xerror');
const { createSchema } = require('zs-common-schema');
const APIRouter = require('../lib/api-router');
const HTTPRPCInterface = require('../lib/http-rpc-interface');

let app, router, request;

// Setup express router
const setupRouter = () => {
	app = express();
	router = new APIRouter();
	request = supertest(app);
	app.use(router.getExpressRouter());

	router.version(1).addInterface(new HTTPRPCInterface());
};

const promisifyRequest = (endpoint, options, expectedResponse) => {
	if (_.isUndefined(expectedResponse) && _.isObject(options)) {
		expectedResponse = options;
		options = {};
	}

	if (_.isUndefined(expectedResponse)) expectedResponse = {};
	if (_.isNumber(options)) options = { status: options };
	if (!_.isNumber(options.status)) options.status = 200;
	if (_.isUndefined(options.params)) options.params = {};

	return new Promise((resolve, reject) => {
		request.post(endpoint)
			// .set('Accept', 'application/json')
			.send({ params: options.params })
			// .expect('Content-Type', /json/)
			.expect(options.status, expectedResponse, (err) => {
				if (err) return reject(err);
				resolve();
			});
	});
};

describe('APIRouter', function() {
	beforeEach(setupRouter);

	it('#constructor', function() {
		expect(router.preRouter).to.be.a('function');
		expect(router.preRouter.name).to.equal('router');

		expect(router.versionsRouter).to.be.a('function');
		expect(router.versionsRouter.name).to.equal('router');

		expect(router.router).to.be.a('function');
		expect(router.router.name).to.equal('router');
	});

	it('should add versioned interfaces', function() {
		router.version(0);

		expect(Object.keys(router.versionRouters).length).to.equal(2);
		expect(router.versionRouters[0].version).to.equal(0);
		expect(router.versionRouters[0].interfaces).to.be.empty;
		expect(router.versionRouters[1].version).to.equal(1);
		expect(router.versionRouters[1].interfaces).to.have.length(1);
	});

	it('#register should support returns', function() {
		router.register({
			method: 'method'
		}, () => {
			return 'some result';
		});

		return promisifyRequest('/v1/rpc/method', { result: 'some result' });
	});

	it('#register should support errors', function() {
		router.register({
			method: 'method'
		}, () => {
			throw new Error('some error');
		});

		return promisifyRequest('/v1/rpc/method', { error: { code: 'internal_error', message: 'some error' } });
	});

	it('#register should support segmented method names', function() {
		router.register({
			method: 'method.with.long.name'
		}, () => {
			return { long: true };
		});

		return promisifyRequest('/v1/rpc/method/with/long/name', { result: { long: true } });
	});

	it('should support resolving promises in methods', function() {
		router.register({
			method: 'resolve'
		}, () => {
			return new Promise((resolve) => {
				setImmediate(() => resolve({ foo: 'bar' }));
			});
		});

		return promisifyRequest('/v1/rpc/resolve', { result: { foo: 'bar' } });
	});

	it('should support rejecting promises in methods', function() {
		router.register({
			method: 'reject'
		}, () => {
			return new Promise((resolve, reject) => {
				setImmediate(() => reject(new Error('some error')));
			});
		});

		return promisifyRequest('/v1/rpc/reject', { error: { code: 'internal_error', message: 'some error' } });
	});

	it('should support XErrors', function() {
		router.register({
			method: 'not_modified'
		}, () => {
			throw new XError(XError.NOT_MODIFIED, 'I\'m afraid I can\'t do that.');
		});

		router.register({
			method: 'limit_exceeded'
		}, () => {
			return new Promise((resolve, reject) => {
				setImmediate(() => reject(new XError(XError.LIMIT_EXCEEDED, 'STOP DOING THAT!')));
			});
		});

		return promisifyRequest('/v1/rpc/not_modified', {
			error: { code: 'not_modified', message: 'I\'m afraid I can\'t do that.' }
		})
			.then(() => promisifyRequest('/v1/rpc/limit_exceeded', {
				error: { code: 'limit_exceeded', message: 'STOP DOING THAT!' }
			}));
	});

	it('should register methods with middleware', function() {
		router.register({
			method: 'method.with.middleware'
		}, (ctx) => {
			ctx.data = { one: 1 };
		}, (ctx) => {
			ctx.data.two = 2;
			return ctx.data;
		});

		let numEnteredMiddlewares = 0;
		router.register({
			method: 'method.with.skipped.middleware'
		}, () => {
			numEnteredMiddlewares += 1;
			return { one: 1 };
		}, () => {
			numEnteredMiddlewares += 1;
			return { two: 2 };
		});

		return promisifyRequest('/v1/rpc/method/with/middleware', { result: { one: 1, two: 2 } })
			.then(() => promisifyRequest('/v1/rpc/method/with/skipped/middleware', { result: { one: 1 } }))
			.then(() => {
				expect(numEnteredMiddlewares).to.equal(1);
			});
	});

	it('should add methods to VersionRouters', function() {
		let newRouter = router.version(2);
		newRouter.addInterface(new HTTPRPCInterface());

		newRouter.register({
			method: 'version-specific'
		}, () => {
			return { foo: 'bar' };
		});

		return promisifyRequest('/v1/rpc/version-specific', 500)
			.then(() => promisifyRequest('/v2/rpc/version-specific', { result: { foo: 'bar' } }));
	});

	it('should add version-specific methods', function() {
		router.version(2).addInterface(new HTTPRPCInterface());
		router.version(3).addInterface(new HTTPRPCInterface());
		router.version(4).addInterface(new HTTPRPCInterface());
		router.version(5).addInterface(new HTTPRPCInterface());

		router.register({
			method: 'single',
			versions: [ 1, '3' ]
		}, () => {
			return true;
		});

		router.register({
			method: 'ranges',
			versions: [ '1-2', '4-4' ]
		}, () => {
			return true;
		});

		router.register({
			method: 'open.ranges',
			versions: [ '-2', '4-' ]
		}, () => {
			return true;
		});

		router.register({
			method: 'everything.ever',
			versions: [ '-1', 3, '4-5' ]
		}, () => {
			return true;
		});

		return promisifyRequest('/v1/rpc/single', { result: true })
			.then(() => promisifyRequest('/v2/rpc/single', 500))
			.then(() => promisifyRequest('/v3/rpc/single', { result: true }))
			.then(() => promisifyRequest('/v1/rpc/ranges', { result: true }))
			.then(() => promisifyRequest('/v2/rpc/ranges', { result: true }))
			.then(() => promisifyRequest('/v3/rpc/ranges', 500))
			.then(() => promisifyRequest('/v4/rpc/ranges', { result: true }))
			.then(() => promisifyRequest('/v5/rpc/ranges', 500))
			.then(() => promisifyRequest('/v1/rpc/open/ranges', { result: true }))
			.then(() => promisifyRequest('/v2/rpc/open/ranges', { result: true }))
			.then(() => promisifyRequest('/v3/rpc/open/ranges', 500))
			.then(() => promisifyRequest('/v4/rpc/open/ranges', { result: true }))
			.then(() => promisifyRequest('/v5/rpc/open/ranges', { result: true }))
			.then(() => promisifyRequest('/v1/rpc/everything/ever', { result: true }))
			.then(() => promisifyRequest('/v2/rpc/everything/ever', 500))
			.then(() => promisifyRequest('/v3/rpc/everything/ever', { result: true }))
			.then(() => promisifyRequest('/v4/rpc/everything/ever', { result: true }))
			.then(() => promisifyRequest('/v5/rpc/everything/ever', { result: true }));
	});

	it('should register pre-middleware', function() {
		router.registerPreMiddleware({}, (ctx) => {
			ctx.someProp = 'foo';
		});

		router.register({
			method: 'method.with.pre.middleware'
		}, (ctx) => {
			return { someProp: ctx.someProp };
		});

		return promisifyRequest('/v1/rpc/method/with/pre/middleware', { result: { someProp: 'foo' } });
	});

	it('should register post-middleware', function() {
		let hasRanMiddleware = false;
		router.registerPostMiddleware({}, () => {
			hasRanMiddleware = true;
		});

		router.register({
			method: 'method.with.post.middleware'
		}, () => {
			return 'some response';
		});

		return promisifyRequest('/v1/rpc/method/with/post/middleware', { result: 'some response' })
			.then(() => {
				expect(hasRanMiddleware).to.be.true;
			});
	});

	it('should accept params', function() {
		router.register({
			method: 'schema'
		}, (ctx) => ctx.params);

		return promisifyRequest(
			'/v1/rpc/schema',
			{ params: { foo: 'bar', baz: 64 } },
			{ result: { foo: 'bar', baz: 64 } }
		);
	});

	it('should normalize params to schema', function() {
		router.register({
			method: 'schema',
			schema: createSchema({ foo: Boolean })
		}, (ctx) => ctx.params);

		return promisifyRequest(
			'/v1/rpc/schema',
			{ params: { foo: 'true' } },
			{ result: { foo: true } }
		);
	});

	it('should accept normalization options', function() {
		router.register({
			method: 'no.schema.options',
			schema: createSchema({ foo: Boolean })
		}, (ctx) => ctx.params);

		router.register({
			method: 'schema.options',
			schema: createSchema({ foo: Boolean }),
			normalizeOptions: { removeUnknownFields: true }
		}, (ctx) => ctx.params);

		return promisifyRequest(
			'/v1/rpc/no/schema/options',
			{ params: { foo: 'true', bar: 64 } },
			{
				error: {
					code: 'validation_error',
					data: {
						fieldErrors: [ {
							code: 'unknown_field',
							field: 'bar',
							message: 'Unknown field'
						} ]
					},
					message: 'Unknown field'
				}
			}
		)
			.then(() => {
				return promisifyRequest(
					'/v1/rpc/schema/options',
					{ params: { foo: 'true', bar: 64 } },
					{ result: { foo: true } }
				);
			});
	});

	it('should create schema instance', function() {
		router.register({
			method: 'schema',
			schema: { foo: Boolean }
		}, (ctx) => ctx.params);

		return promisifyRequest(
			'/v1/rpc/schema',
			{ params: { foo: 'false' } },
			{ result: { foo: false } }
		);
	});

	it('should error on invalid schema', function() {
		let fn = () => {
			return router.register({
				method: 'schema',
				schema: [ 2, 4 ]
			}, (ctx) => ctx.params);
		};

		expect(fn).to.throw(XError);
	});

	it('should normalize response to schema', function() {
		router.register({
			method: 'response.schema.instance',
			responseSchema: createSchema({ foo: Boolean })
		}, () => {
			return { foo: 'true' };
		});

		return promisifyRequest(
			'/v1/rpc/response/schema/instance',
			{ result: { foo: true } }
		);
	});

	it('should create response schema instance', function() {
		router.register({
			method: 'response.schema.instance',
			responseSchema: { foo: Boolean }
		}, () => {
			return { foo: 'true' };
		});

		return promisifyRequest(
			'/v1/rpc/response/schema/instance',
			{ result: { foo: true } }
		);
	});
});
