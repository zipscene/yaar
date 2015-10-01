const supertest = require('supertest');
const express = require('express');
const _ = require('lodash');
const expect = require('chai').expect;
const XError = require('xerror');
const APIRouter = require('../lib/api-router');
const JSONRPCInterface = require('../lib/json-rpc-interface');

let app, router, request;

// Setup express router
const setupRouter = () => {
	app = express();
	router = new APIRouter();
	request = supertest(app);
	app.use(router.getExpressRouter());

	router.version(1).addInterface(new JSONRPCInterface());
};

const promisifyRequest = (endpoint, options, expectedResponse) => {
	if (!options) throw new XError(XError.INVALID_REQUEST, `No options specified`);

	if (_.isUndefined(expectedResponse)) expectedResponse = {};
	if (!_.isNumber(options.status)) options.status = 200;
	if (_.isUndefined(options.params)) options.params = {};

	return new Promise((resolve, reject) => {
		request.post(endpoint)
			// .set('Accept', 'application/json')
			.send({
				method: options.method,
				params: options.params,
				id: options.id
			})
			// .expect('Content-Type', /json/)
			.expect(options.status, expectedResponse, (err) => {
				if (err) return reject(err);
				resolve();
			});
	});
};

describe('JSONRPCInterface', function() {
	beforeEach(setupRouter);

	it('#register should support returns', function() {
		router.register({
			method: 'method'
		}, () => {
			return 'some result';
		});

		return promisifyRequest('/v1/jsonrpc', {
			method: 'method',
			id: 'someId'
		}, {
			result: 'some result',
			id: 'someId'
		});
	});

	it('#register should support errors', function() {
		router.register({
			method: 'method'
		}, () => {
			throw new Error('some error');
		});

		return promisifyRequest('/v1/jsonrpc', {
			method: 'method',
			id: 'someId'
		}, {
			error: { code: 'internal_error', message: 'some error' },
			id: 'someId'
		});
	});

	it('#register should support segmented method names', function() {
		router.register({
			method: 'method.with.long.name'
		}, () => {
			return { long: true };
		});

		return promisifyRequest('/v1/jsonrpc', {
			method: 'method.with.long.name',
			id: 'someId'
		}, {
			result: { long: true },
			id: 'someId'
		});
	});

	it('should support resolving promises in methods', function() {
		router.register({
			method: 'resolve'
		}, () => {
			return new Promise((resolve) => {
				setImmediate(() => resolve({ foo: 'bar' }));
			});
		});

		return promisifyRequest('/v1/jsonrpc', {
			method: 'resolve',
			id: 'someOtherId'
		}, {
			result: { foo: 'bar' },
			id: 'someOtherId'
		});
	});

	it('should support rejecting promises in methods', function() {
		router.register({
			method: 'reject'
		}, () => {
			return new Promise((resolve, reject) => {
				setImmediate(() => reject(new Error('some error')));
			});
		});

		return promisifyRequest('/v1/jsonrpc', {
			method: 'reject',
			id: 'someId'
		}, {
			error: { code: 'internal_error', message: 'some error' },
			id: 'someId'
		});
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

		return promisifyRequest('/v1/jsonrpc', {
			method: 'not_modified',
			id: 'someId'
		}, {
			error: { code: 'not_modified', message: 'I\'m afraid I can\'t do that.' },
			id: 'someId'
		})
			.then(() => promisifyRequest('/v1/jsonrpc', {
				method: 'limit_exceeded',
				id: 'someOtherId'
			}, {
				error: { code: 'limit_exceeded', message: 'STOP DOING THAT!' },
				id: 'someOtherId'
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

		return promisifyRequest('/v1/jsonrpc', {
			method: 'method.with.middleware',
			id: 'someId'
		}, {
			result: { one: 1, two: 2 },
			id: 'someId'
		})
			.then(() => promisifyRequest('/v1/jsonrpc', {
				method: 'method.with.skipped.middleware',
				id: 'someOtherId'
			}, {
				result: { one: 1 },
				id: 'someOtherId'
			}))
			.then(() => {
				expect(numEnteredMiddlewares).to.equal(1);
			});
	});

	it('should add methods to VersionRouters', function() {
		let newRouter = router.version(2);
		newRouter.addInterface(new JSONRPCInterface());

		newRouter.register({
			method: 'version-specific'
		}, () => {
			return { foo: 'bar' };
		});

		return promisifyRequest('/v1/jsonrpc', {
			method: 'version-specific',
			id: 'someId'
		}, {
			error: {
				code: 'not_found',
				message: `method: version-specific doesn't exist`
			},
			id: 'someId'
		})
			.then(() => promisifyRequest('/v2/jsonrpc', {
				method: 'version-specific',
				id: 'someOtherId'
			}, {
				result: { foo: 'bar' },
				id: 'someOtherId'
			}));
	});

	it('should add version-specific methods', function() {
		router.version(2).addInterface(new JSONRPCInterface());
		router.version(3).addInterface(new JSONRPCInterface());
		router.version(4).addInterface(new JSONRPCInterface());
		router.version(5).addInterface(new JSONRPCInterface());

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

		return promisifyRequest('/v1/jsonrpc', {
			method: 'single',
			id: 1
		}, {
			result: true,
			id: '1'
		})
			.then(() => promisifyRequest('/v2/jsonrpc', {
				method: 'single',
				id: 'id2'
			}, {
				error: {
					code: 'not_found',
					message: `method: single doesn't exist`
				},
				id: 'id2'
			}))
			.then(() => promisifyRequest('/v3/jsonrpc', {
				method: 'single',
				id: 'id3'
			}, {
				result: true,
				id: 'id3'
			}))
			.then(() => promisifyRequest('/v1/jsonrpc', {
				method: 'ranges',
				id: 'id4'
			}, {
				result: true,
				id: 'id4'
			}))
			.then(() => promisifyRequest('/v2/jsonrpc', {
				method: 'ranges',
				id: 'id5'
			}, {
				result: true,
				id: 'id5'
			}))
			.then(() => promisifyRequest('/v3/jsonrpc', {
				method: 'ranges',
				id: 'id6'
			}, {
				error: {
					code: 'not_found',
					message: `method: ranges doesn't exist`
				},
				id: 'id6'
			}))
			.then(() => promisifyRequest('/v4/jsonrpc', {
				method: 'ranges',
				id: 'id7'
			}, {
				result: true,
				id: 'id7'
			}))
			.then(() => promisifyRequest('/v5/jsonrpc', {
				method: 'ranges',
				id: 'id8'
			}, {
				error: {
					code: 'not_found',
					message: `method: ranges doesn't exist`
				},
				id: 'id8'
			}))
			.then(() => promisifyRequest('/v1/jsonrpc', {
				method: 'open.ranges',
				id: 'id9'
			}, {
				result: true,
				id: 'id9'
			}))
			.then(() => promisifyRequest('/v2/jsonrpc', {
				method: 'open.ranges',
				id: 'id10'
			}, {
				result: true,
				id: 'id10'
			}))
			.then(() => promisifyRequest('/v3/jsonrpc', {
				method: 'open.ranges',
				id: 'id11'
			}, {
				error: {
					code: 'not_found',
					message: `method: open.ranges doesn't exist`
				},
				id: 'id11'
			}))
			.then(() => promisifyRequest('/v4/jsonrpc', {
				method: 'open.ranges',
				id: 'id12'
			}, {
				result: true,
				id: 'id12'
			}))
			.then(() => promisifyRequest('/v5/jsonrpc', {
				method: 'open.ranges',
				id: 'id13'
			}, {
				result: true,
				id: 'id13'
			}))
			.then(() => promisifyRequest('/v1/jsonrpc', {
				method: 'everything.ever',
				id: 'id14'
			}, {
				result: true,
				id: 'id14'
			}))
			.then(() => promisifyRequest('/v2/jsonrpc', {
				method: 'everything.ever',
				id: 'id15'
			}, {
				error: {
					code: 'not_found',
					message: `method: everything.ever doesn't exist`
				},
				id: 'id15'
			}))
			.then(() => promisifyRequest('/v3/jsonrpc', {
				method: 'everything.ever',
				id: 'id16'
			}, {
				result: true,
				id: 'id16'
			}))
			.then(() => promisifyRequest('/v4/jsonrpc', {
				method: 'everything.ever',
				id: 'id17'
			}, {
				result: true,
				id: 'id17'
			}))
			.then(() => promisifyRequest('/v5/jsonrpc', {
				method: 'everything.ever',
				id: 'id18'
			}, {
				result: true,
				id: 'id18'
			}));
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

		return promisifyRequest('/v1/jsonrpc', {
			method: 'method.with.pre.middleware',
			id: 'someId'
		}, {
			result: { someProp: 'foo' },
			id: 'someId'
		});
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

		return promisifyRequest('/v1/jsonrpc', {
			method: 'method.with.post.middleware',
			id: 'someId'
		}, {
			result: 'some response',
			id: 'someId'
		})
			.then(() => {
				expect(hasRanMiddleware).to.be.true;
			});
	});

	it('should accept params', function() {
		router.register({
			method: 'schema'
		}, (ctx) => ctx.params);

		return promisifyRequest(
			'/v1/jsonrpc',
			{
				method: 'schema',
				id: 'someId',
				params: { foo: 'bar', baz: 64 }
			},
			{
				result: { foo: 'bar', baz: 64 },
				id: 'someId'
			}
		);
	});

});
