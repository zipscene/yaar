// Copyright 2016 Zipscene, LLC
// Licensed under the Apache License, Version 2.0
// http://www.apache.org/licenses/LICENSE-2.0

const expect = require('chai').expect;
const XError = require('xerror');
const { runCallMiddleware } = require('../lib/utils');

describe('runCallMiddleware()', function() {
	it('should set result from middleware', function() {
		let middlewares = [
			(ctx) => { ctx.something = true; },
			() => 'foo'
		];

		let promiseMiddlewares = [
			(ctx) => { ctx.something = true; },
			() => { return new Promise((resolve) => resolve('bar')); }
		];

		return runCallMiddleware({}, false, middlewares)
			.then((ctx) => {
				expect(ctx.result).to.equal('foo');
			})
			.then(() => runCallMiddleware({}, false, promiseMiddlewares))
			.then((ctx) => {
				expect(ctx.result).to.equal('bar');
			});
	});

	it('should set errors from middleware', function() {
		let middlewares = [
			(ctx) => { ctx.something = true; },
			() => { throw new XError(XError.ACCESS_DENIED, 'foo'); }
		];

		let promiseMiddlewares = [
			(ctx) => { ctx.something = true; },
			() => { return new Promise((resolve, reject) => reject(new Error('bar'))); }
		];

		return runCallMiddleware({}, false, middlewares)
			.then((ctx) => {
				expect(ctx.error).to.be.instanceof(XError);
				expect(ctx.error.message).to.equal('foo');
				expect(ctx.error.code).to.equal(XError.ACCESS_DENIED);
			})
			.then(() => runCallMiddleware({}, false, promiseMiddlewares))
			.then((ctx) => {
				expect(ctx.error).to.be.instanceof(Error);
				expect(ctx.error.message).to.equal('bar');
			});
	});

	it('should run pre-middleware until a result is returned', function() {
		let ctx = { numPriorMiddlewares: 0 };
		let promiseCtx = { numPriorMiddlewares: 0 };

		let middlewares = [
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			() => 'foo',
			(ctx) => { ctx.numPriorMiddlewares += 1; }
		];

		let promiseMiddlewares = [
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			() => { return new Promise((resolve) => resolve('foo')); },
			(ctx) => { ctx.numPriorMiddlewares += 1; }
		];

		return runCallMiddleware(ctx, false, middlewares)
			.then((ctx) => {
				expect(ctx.numPriorMiddlewares).to.equal(3);
			})
			.then(() => runCallMiddleware(promiseCtx, false, promiseMiddlewares))
			.then((ctx) => {
				expect(ctx.numPriorMiddlewares).to.equal(3);
			});
	});

	it('should run pre-middleware until an error is returned', function() {
		let ctx = { numPriorMiddlewares: 0 };
		let promiseCtx = { numPriorMiddlewares: 0 };

		let middlewares = [
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			() => { throw new XError(XError.ACCESS_DENIED, 'foo'); },
			(ctx) => { ctx.numPriorMiddlewares += 1; }
		];

		let promiseMiddlewares = [
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			() => { return new Promise((resolve, reject) => reject(new Error('bar'))); },
			(ctx) => { ctx.numPriorMiddlewares += 1; }
		];

		return runCallMiddleware(ctx, false, middlewares)
			.then((ctx) => {
				expect(ctx.numPriorMiddlewares).to.equal(3);
			})
			.then(() => runCallMiddleware(promiseCtx, false, promiseMiddlewares))
			.then((ctx) => {
				expect(ctx.numPriorMiddlewares).to.equal(3);
			});
	});

	it('should run post-middleware regardless of errors', function() {
		let ctx = { numPriorMiddlewares: 0 };
		let promiseCtx = { numPriorMiddlewares: 0 };

		let middlewares = [
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			() => { throw new XError(XError.ACCESS_DENIED, 'foo'); },
			(ctx) => { ctx.numPriorMiddlewares += 1; }
		];

		let promiseMiddlewares = [
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			(ctx) => { ctx.numPriorMiddlewares += 1; },
			() => { return new Promise((resolve, reject) => reject(new Error('bar'))); },
			(ctx) => { ctx.numPriorMiddlewares += 1; }
		];

		return runCallMiddleware(ctx, true, middlewares)
			.then((ctx) => {
				expect(ctx.numPriorMiddlewares).to.equal(4);
			})
			.then(() => runCallMiddleware(promiseCtx, true, promiseMiddlewares))
			.then((ctx) => {
				expect(ctx.numPriorMiddlewares).to.equal(4);
			});
	});

	it('should store all errors in post-middleware', function() {
		let middlewares = [
			() => { throw new XError(XError.ACCESS_DENIED, 'foo'); },
			() => { return new Promise((resolve, reject) => reject(new Error('bar'))); }
		];

		return runCallMiddleware({}, true, middlewares)
			.then((ctx) => {
				expect(ctx.extraErrors).to.be.instanceof(Array);
				expect(ctx.extraErrors.length).to.equal(2);
				expect(ctx.extraErrors[0]).to.be.instanceof(XError);
				expect(ctx.extraErrors[0].message).to.equal('foo');
				expect(ctx.extraErrors[1]).to.be.instanceof(Error);
				expect(ctx.extraErrors[1].message).to.equal('bar');
			});
	});
});
