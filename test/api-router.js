const supertest = require('supertest');
const express = require('express');
const expect = require('chai').expect;
const APIRouter = require('../lib/api-router');
const HTTPRPCInterface = require('../lib/http-rpc-interface');

// Setup express router
const app = express();
const router = new APIRouter();
const request = supertest(app);
app.use(router.getExpressRouter());

describe('runCallMiddleware()', function() {
	it('should add versioned interfaces', function() {
		let fn = () => {
			router.version(0);
			router.version(1).addInterface(new HTTPRPCInterface());
		};

		expect(fn).to.not.throw();
	});

	it('should add endpoints', function(done) {
		router.register({
			method: 'endpoint'
		}, (ctx) => {
			ctx.res.json({ foo: 'bar' });
		});

		request.post('/v1/rpc/endpoint')
			.expect(200, { foo: 'bar' }, done);
	});

	it('should add version-specific endpoints', function(done) {
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
});
