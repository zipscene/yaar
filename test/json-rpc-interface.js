const supertest = require('supertest');
const express = require('express');
const _ = require('lodash');
const { expect } = require('chai');
const XError = require('xerror');
const { createSchema } = require('zs-common-schema');
const { APIRouter, JSONRPCInterface } = require('../lib');
const zstreams = require('zstreams');
const pasync = require('pasync');
const http = require('http');

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
			.send({
				method: options.method,
				params: options.params,
				id: options.id
			})
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
			id: 'someId',
			error: null
		});
	});

	it('#regiester should support empty id', function() {
		router.register({
			method: 'method'
		}, () => {
			return 'some result';
		});

		return promisifyRequest('/v1/jsonrpc', {
			method: 'method'
		}, {
			result: 'some result',
			error: null
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
			id: 'someId',
			result: null
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
			id: 'someId',
			error: null
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
			id: 'someOtherId',
			error: null
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
			id: 'someId',
			result: null
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
			id: 'someId',
			result: null
		})
			.then(() => promisifyRequest('/v1/jsonrpc', {
				method: 'limit_exceeded',
				id: 'someOtherId'
			}, {
				error: { code: 'limit_exceeded', message: 'STOP DOING THAT!' },
				id: 'someOtherId',
				result: null
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
			id: 'someId',
			error: null
		})
			.then(() => promisifyRequest('/v1/jsonrpc', {
				method: 'method.with.skipped.middleware',
				id: 'someOtherId'
			}, {
				result: { one: 1 },
				id: 'someOtherId',
				error: null
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
			id: 'someId',
			result: null
		})
			.then(() => promisifyRequest('/v2/jsonrpc', {
				method: 'version-specific',
				id: 'someOtherId'
			}, {
				result: { foo: 'bar' },
				id: 'someOtherId',
				error: null
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
			id: '1',
			error: null
		})
			.then(() => promisifyRequest('/v2/jsonrpc', {
				method: 'single',
				id: 'id2'
			}, {
				error: {
					code: 'not_found',
					message: `method: single doesn't exist`
				},
				id: 'id2',
				result: null
			}))
			.then(() => promisifyRequest('/v3/jsonrpc', {
				method: 'single',
				id: 'id3'
			}, {
				result: true,
				id: 'id3',
				error: null
			}))
			.then(() => promisifyRequest('/v1/jsonrpc', {
				method: 'ranges',
				id: 'id4'
			}, {
				result: true,
				id: 'id4',
				error: null
			}))
			.then(() => promisifyRequest('/v2/jsonrpc', {
				method: 'ranges',
				id: 'id5'
			}, {
				result: true,
				id: 'id5',
				error: null
			}))
			.then(() => promisifyRequest('/v3/jsonrpc', {
				method: 'ranges',
				id: 'id6'
			}, {
				error: {
					code: 'not_found',
					message: `method: ranges doesn't exist`
				},
				id: 'id6',
				result: null
			}))
			.then(() => promisifyRequest('/v4/jsonrpc', {
				method: 'ranges',
				id: 'id7'
			}, {
				result: true,
				id: 'id7',
				error: null
			}))
			.then(() => promisifyRequest('/v5/jsonrpc', {
				method: 'ranges',
				id: 'id8'
			}, {
				error: {
					code: 'not_found',
					message: `method: ranges doesn't exist`
				},
				id: 'id8',
				result: null
			}))
			.then(() => promisifyRequest('/v1/jsonrpc', {
				method: 'open.ranges',
				id: 'id9'
			}, {
				result: true,
				id: 'id9',
				error: null
			}))
			.then(() => promisifyRequest('/v2/jsonrpc', {
				method: 'open.ranges',
				id: 'id10'
			}, {
				result: true,
				id: 'id10',
				error: null
			}))
			.then(() => promisifyRequest('/v3/jsonrpc', {
				method: 'open.ranges',
				id: 'id11'
			}, {
				error: {
					code: 'not_found',
					message: `method: open.ranges doesn't exist`
				},
				id: 'id11',
				result: null
			}))
			.then(() => promisifyRequest('/v4/jsonrpc', {
				method: 'open.ranges',
				id: 'id12'
			}, {
				result: true,
				id: 'id12',
				error: null
			}))
			.then(() => promisifyRequest('/v5/jsonrpc', {
				method: 'open.ranges',
				id: 'id13'
			}, {
				result: true,
				id: 'id13',
				error: null
			}))
			.then(() => promisifyRequest('/v1/jsonrpc', {
				method: 'everything.ever',
				id: 'id14'
			}, {
				result: true,
				id: 'id14',
				error: null
			}))
			.then(() => promisifyRequest('/v2/jsonrpc', {
				method: 'everything.ever',
				id: 'id15'
			}, {
				error: {
					code: 'not_found',
					message: `method: everything.ever doesn't exist`
				},
				id: 'id15',
				result: null
			}))
			.then(() => promisifyRequest('/v3/jsonrpc', {
				method: 'everything.ever',
				id: 'id16'
			}, {
				result: true,
				id: 'id16',
				error: null
			}))
			.then(() => promisifyRequest('/v4/jsonrpc', {
				method: 'everything.ever',
				id: 'id17'
			}, {
				result: true,
				id: 'id17',
				error: null
			}))
			.then(() => promisifyRequest('/v5/jsonrpc', {
				method: 'everything.ever',
				id: 'id18'
			}, {
				result: true,
				id: 'id18',
				error: null
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
			id: 'someId',
			error: null
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
			id: 'someId',
			error: null
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
			}, {
				result: { foo: 'bar', baz: 64 },
				id: 'someId',
				error: null
			}
		);
	});

	it('should normalize params to schema', function() {
		router.register({
			method: 'schema',
			schema: createSchema({ foo: Boolean, bar: Number })
		}, (ctx) => ctx.params);

		return promisifyRequest(
			'/v1/jsonrpc',
			{
				method: 'schema',
				id: 'someId',
				params: { foo: 'true' }
			}, {
				result: { foo: true },
				id: 'someId',
				error: null
			}
		);
	});

	it('should normalize response to schema', function() {
		router.register({
			method: 'result.schema',
			responseSchema: createSchema({ foo: Boolean })
		}, () => {
			return { foo: 'true' };
		});

		return promisifyRequest(
			'/v1/jsonrpc',
			{
				method: 'result.schema',
				id: 'someId'
			}, {
				result: { foo: true },
				id: 'someId',
				error: null
			}
		);
	});

	it('should create response schema instance', function() {
		router.register({
			method: 'result.schema.instance',
			responseSchema: { foo: Boolean }
		}, () => {
			return { foo: 'true' };
		});

		return promisifyRequest(
			'/v1/jsonrpc',
			{
				method: 'result.schema.instance',
				id: 'someId'
			}, {
				result: { foo: true },
				id: 'someId',
				error: null
			}
		);
	});

	it('should allow manual responses', function() {
		router.register({
			method: 'manual.response',
			manualResponse: true
		}, (ctx) => {
			ctx.res.status(200).send('abcd');
		});

		return promisifyRequest(
			'/v1/jsonrpc',
			{
				method: 'manual.response',
				id: 'someId'
			},
			'abcd'
		);
	});

	it('should allow streaming responses', function() {
		router.register({
			method: 'streaming.response',
			streamingResponse: true
		}, () => {
			return Promise.resolve(
				zstreams.fromArray([ 'foo', 'bar\n', { foo: 'bar' } ])
			);
		});

		return promisifyRequest(
			'/v1/jsonrpc',
			{
				method: 'streaming.response',
				id: 'YATTA'
			}, [
				'foo',
				'bar',
				'{"foo":"bar"}',
				'{"success":true}'
			].join('\n') + '\n'
		);
	});

	it('should close response stream when connection dies', function() {
		let waiter = pasync.waiter();

		router.register({
			method: 'streaming.response.end',
			streamingResponse: true
		}, () => {
			let stream = new zstreams.PassThrough({
				objectMode: true
			});
			stream.on('chainerror', (error) => {
				waiter.reject(error);
			});
			stream.on('end', () => {
				waiter.resolve();
			});
			stream.write({ foo: 'YATTA' });
			return Promise.resolve(stream.pipe(new zstreams.PassThrough({
				objectMode: true
			})));
		});

		// Real life request!
		app.listen(17113, function(error) {
			if (error) throw error;

			let postData = JSON.stringify({
				method: 'streaming.response.end',
				params: {}
			});
			let req = http.request({
				method: 'POST',
				host: 'localhost',
				port: 17113,
				path: '/v1/jsonrpc',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': postData.length
				}
			}, () => {
				setTimeout(() => {
					req.abort();
				}, 500);
			});

			req.write(postData);
			req.end();
		});


		return waiter.promise;
	});

	it('should emit router events', function() {
		let waiter = pasync.waiter();
		let state = 'waiting';

		router.register({
			method: 'ez.route'
		}, () => {
			return { foo: 'true' };
		});

		router.on('request-begin', (ctx) => {
			if (ctx.method !== 'ez.route' || state !== 'waiting') {
				return waiter.reject(new Error('wat'));
			}
			state = 'begin';
		});
		router.on('request-end', (ctx) => {
			if (ctx.method !== 'ez.route' || state !== 'begin') {
				return waiter.reject(new Error('literally wat'));
			}
			waiter.resolve();
		});
		router.on('request-error', (ctx, error) => {
			return waiter.reject(error);
		});

		request.post('/v1/jsonrpc')
			.send({
				method: 'ez.route',
				params: {}
			})
			.end(function() {});

		return waiter.promise;
	});

	it('should emit router events, streaming edition', function() {
		let waiter = pasync.waiter();
		let state = 'waiting';

		router.register({
			method: 'ez.route.stream',
			streamingResponse: true
		}, () => {
			return Promise.resolve(
				zstreams.fromArray([ 'foo', 'bar\n', { foo: 'bar' } ])
			);
		});

		router.on('request-begin', (ctx) => {
			if (ctx.method !== 'ez.route.stream' || state !== 'waiting') {
				return waiter.reject(new Error('wat'));
			}
			state = 'begin';
		});
		router.on('request-end', (ctx) => {
			if (ctx.method !== 'ez.route.stream' || state !== 'begin') {
				return waiter.reject(new Error('literally wat'));
			}
			waiter.resolve();
		});
		router.on('request-error', (ctx, error) => {
			return waiter.reject(error);
		});

		request.post('/v1/jsonrpc')
			.send({
				method: 'ez.route.stream',
				params: {}
			})
			.end(function() {});

		return waiter.promise;
	});

	it('should include register options as routeOptions on context', function() {
		let options = { method: 'route.options' };
		router.register(options, (ctx) => {
			return ctx.routeOptions;
		});

		return promisifyRequest(
			'/v1/jsonrpc',
			{
				method: 'route.options',
				id: 'asdf'
			},
			{
				id: 'asdf',
				result: options,
				error: null
			}
		);
	});

});
