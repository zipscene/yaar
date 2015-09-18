const _ = require('lodash');
const pasync = require('pasync');
const XError = require('xerror');

/**
 * Wraps express middleware such that errors aren't silently swallowed.
 * This just surrounds the middleware in a try/catch that throws a global exception.
 *
 * @method wrapExpressMiddleware
 * @param {Function} middleware - The unwrapped middleware.
 *   Either function(req, res, next) or function(err, req, res, next)
 * @return {Function} - The same type of function, but wrapped for exception handling.
 * @since v0.0.1
 */
const wrapExpressMiddleware = function(middleware) {
	return function(...args) {
		try {
			return middleware.call(this, ...args);
		} catch (ex) {
			pasync.abort(ex);
		}
	};
};

/**
 * Runs a series of middleware for an API call.
 * This handles pre-middleware, API call middleware, and post-middleware.
 *
 * All middlewares in the list are passed a `ctx` object.
 * For pre-middleware and API call middleware, if the middleware resolves with a non-null value or rejects,
 * no further middleware are executed.
 * In this case, either `ctx.result` or `ctx.error` is set with the return value.
 *
 * Post-middleware are executed regardless of whether or not an earlier middleware has returned with a value.
 * The resolve value of post-middleware is ignored.
 * Errors thrown by post-middleware are not sent to the client;
 * instead, they are logged out to the console and added to the `ctx.extraErrors` array.
 * Post-middleware may mutate `ctx` and the `ctx.result` or `ctx.error` values.
 *
 * All middleware may either return a Promise or (synchronously) a value.
 * Any thrown exceptions are treated as rejected Promises.
 *
 * @method runCallMiddleware
 * @param {Object} ctx - The context object to pass to the middleware.
 *   This may be mutated by adding `result`, `error`, and `extraErrors` properties.
 * @param {Boolean} isPostMiddleware - If set to true, the middlewares are treated as post-middleware.
 * @param {Array{Function}} middlewares - An array of middleware functions with the signature
 *   `function(ctx)` .
 * @return {Promise} - Resolves with `ctx`.
 *   Should never reject.  To detect request errors, check `ctx.error` .
 * @since v0.0.1
 **/
const runCallMiddleware = function(ctx, isPostMiddleware, middlewares) {
	return pasync.eachSeries(middlewares, (middleware) => {
		if (!isPostMiddleware && (ctx.result || ctx.error)) return Promise.resolve();

		let result;

		try {
			result = middleware(ctx);
		} catch (ex) {
			result = Promise.reject(ex);
		}

		if (!result || !_.isFunction(result.then)) result = Promise.resolve(result);

		return result
			.then((result) => {
				if (!isPostMiddleware && result) {
					ctx.result = result;
				}
			}, (err) => {
				if (isPostMiddleware) {
					if (!ctx.extraErrors) ctx.extraErrors = [];
					ctx.extraErrors.push(err);
					console.log('Error in result middleware:', err);
				} else {
					ctx.error = err || new XError(XError.INTERNAL_ERROR, 'Error in request middleware');
				}
			});
	})
		.then(() => ctx);
};

module.exports = {
	wrapExpressMiddleware,
	runCallMiddleware
};
