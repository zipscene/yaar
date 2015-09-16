const supertest = require('supertest');
const express = require('express');
const expect = require('chai').expect;
const XError = require('xerror');
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

	it('#register should support returns', function(done) {
		router.register({
			method: 'method'
		}, () => {
			return 'some result';
		});

		request.post('/v1/rpc/method')
			.expect(200, { result: 'some result' }, done);
	});

	it('#register should support errors', function(done) {
		router.register({
			method: 'method'
		}, () => {
			throw new Error('some error');
		});

		request.post('/v1/rpc/method')
			.expect(200, { error: { code: 'internal_error', message: 'some error' } }, done);
	});

	it('#register should support segmented method names', function(done) {
		router.register({
			method: 'method.with.long.name'
		}, () => {
			return { long: true };
		});

		request.post('/v1/rpc/method/with/long/name')
			.expect(200, { result: { long: true } }, done);
	});

	it('should support resolving promises in methods', function(done) {
		router.register({
			method: 'resolve'
		}, () => {
			return new Promise((resolve) => {
				setImmediate(() => resolve({ foo: 'bar' }));
			});
		});

		request.post('/v1/rpc/resolve')
			.expect(200, { result: { foo: 'bar' } }, done);
	});

	it('should support rejecting promises in methods', function(done) {
		router.register({
			method: 'reject'
		}, () => {
			return new Promise((resolve, reject) => {
				setImmediate(() => reject(new Error('some error')));
			});
		});

		request.post('/v1/rpc/reject')
			.expect(200, { error: { code: 'internal_error', message: 'some error' } }, done);
	});

	it('should support XErrors', function(done) {
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

		request.post('/v1/rpc/not_modified')
			.expect(200, { error: { code: 'not_modified', message: 'I\'m afraid I can\'t do that.' } }, (err) => {
				if (err) throw err;

				request.post('/v1/rpc/limit_exceeded')
					.expect(200, { error: { code: 'limit_exceeded', message: 'STOP DOING THAT!' } }, done);
			});
	});

	it('should register methods with middleware', function(done) {
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

		request.post('/v1/rpc/method/with/middleware')
			.expect(200, { result: { one: 1, two: 2 } }, (err) => {
				if (err) throw err;

				request.post('/v1/rpc/method/with/skipped/middleware')
					.expect(200, { result: { one: 1 } }, (err) => {
						if (err) throw err;

						expect(numEnteredMiddlewares).to.equal(1);
						done();
					});
			});
	});

	it('should add version-specific methods', function(done) {
		let newRouter = router.version(2);
		newRouter.addInterface(new HTTPRPCInterface());

		newRouter.register({
			method: 'version-specific',
			version: 2
		}, () => {
			return { foo: 'bar' };
		});

		request.post('/v1/rpc/version-specific')
			.expect(500, (err) => {
				if (err) throw err;

				request.post('/v2/rpc/version-specific')
					.expect(200, { result: { foo: 'bar' } }, done);
			});
	});

	it('should register pre-middleware', function(done) {
		router.registerPreMiddleware({}, (ctx) => {
			ctx.someProp = 'foo';
		});

		router.register({
			method: 'method.with.pre.middleware'
		}, (ctx) => {
			return { someProp: ctx.someProp };
		});

		request.post('/v1/rpc/method/with/pre/middleware')
			.expect(200, { result: { someProp: 'foo' } }, done);
	});

	it('should register post-middleware', function(done) {
		let hasRanMiddleware = false;
		router.registerPostMiddleware({}, () => {
			hasRanMiddleware = true;
		});

		router.register({
			method: 'method.with.post.middleware'
		}, () => {
			return 'some response';
		});

		request.post('/v1/rpc/method/with/post/middleware')
			.expect(200, (err) => {
				if (err) throw err;

				expect(hasRanMiddleware).to.be.true;
				done();
			});
	});
});
