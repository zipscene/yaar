const supertest = require('supertest');
const express = require('express');
const expect = require('chai').expect;
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

	it('should register methods', function(done) {
		router.register({
			method: 'method'
		}, (ctx) => {
			ctx.res.json({ foo: 'bar' });
		});

		router.register({
			method: 'method.with.long.name'
		}, (ctx) => {
			ctx.res.json({ long: true });
		});

		request.post('/v1/rpc/method')
			.expect(200, { foo: 'bar' }, () => {
				request.post('/v1/rpc/method/with/long/name')
					.expect(200, { long: true }, done);
			});
	});

	it('should register methods with middleware', function(done) {
		router.register({
			method: 'method.with.middleware'
		}, (ctx) => {
			ctx.data = { one: 1 };
		}, (ctx) => {
			ctx.data.two = 2;
			ctx.res.json(ctx.data);
		});

		let numEnteredMiddlewares = 0;
		router.register({
			method: 'method.with.skipped.middleware'
		}, (ctx) => {
			numEnteredMiddlewares += 1;
			ctx.res.json({ one: 1 });
			return true;
		}, (ctx) => {
			numEnteredMiddlewares += 1;
			ctx.res.json({ two: 2 });
		});

		request.post('/v1/rpc/method/with/middleware')
			.expect(200, { one: 1, two: 2 }, () => {
				request.post('/v1/rpc/method/with/skipped/middleware')
					.expect(200, { one: 1 }, () => {
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
		}, (ctx) => {
			ctx.res.json({ foo: 'bar' });
		});

		request.post('/v1/rpc/version-specific')
			.expect(500, () => {
				request.post('/v2/rpc/version-specific')
					.expect(200, { foo: 'bar' }, done);
			});
	});

	it('should register pre-middleware', function(done) {
		router.registerPreMiddleware({}, (ctx) => {
			ctx.someProp = 'foo';
		});

		router.register({
			method: 'method.with.pre.middleware'
		}, (ctx) => {
			ctx.res.json({ someProp: ctx.someProp });
		});

		request.post('/v1/rpc/method/with/pre/middleware')
			.expect(200, { someProp: 'foo' }, done);
	});

	it('should register post-middleware', function(done) {
		let hasRanMiddleware = false;
		router.registerPostMiddleware({}, () => {
			hasRanMiddleware = true;
		});

		router.register({
			method: 'method.with.post.middleware'
		}, (ctx) => {
			ctx.res.json('some response');
		});

		request.post('/v1/rpc/method/with/post/middleware')
			.expect(200, () => {
				expect(hasRanMiddleware).to.be.true;
				done();
			});
	});
});
