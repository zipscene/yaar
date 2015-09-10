const pasync = require('pasync');
const XError = require('xerror');
const _ = require('lodash');

/**
 * Wraps express middleware such that errors aren't silently swallowed.  This just surrounds
 * the middleware in a try/catch that throws a global exception.
 *
 * @method wrapExpressMiddleware
 * @param {Function} middleware - The unwrapped middleware.  Either function(req, res, next)
 *   or function(err, req, res, next)
 * @return {Function} - The same type of function, but wrapped for exception handling.
 */
function wrapExpressMiddleware(middleware) {
	if (middleware.length === 4) {
		return function(err, req, res, next) {
			try {
				return middleware.call(this, err, req, res, next);
			} catch (ex) {
				pasync.abort(ex);
			}
		};
	} else {
		return function(req, res, next) {
			try {
				return middleware.call(this, req, res, next);
			} catch (ex) {
				pasync.abort(ex);
			}
		};
	}
}

/**
 * Runs a series of middleware for an API call.  This handles pre-middleware, API call middleware,
 * and post-middleware.
 *
 * All middlewares in the list are passed a `context` object.  For pre-middleware and API call
 * middleware, if the middleware resolves with a non-null value, or rejects, no further middleware
 * are executed.  In this case, either `context.result` or `context.error` is set with the return
 * value.
 *
 * Post-middleware are executed regardless of whether or not an earlier middleware has returned with
 * a value.  The resolve value of post-middleware is ignored.  Errors thrown by post-middleware are
 * not sent to the client; instead, they are logged out to the console and added to the
 * `context.extraErrors` array.  Post-middleware may mutate `context` and the `context.result` or
 * `context.error` values.
 *
 * All middleware may either return a Promise or (synchronously) a value.  Any thrown exceptions
 * are treated as rejected Promises.
 *
 * @method runCallMiddleware
 * @param {Object} context - The context object to pass to the middleware.  This may be mutated
 *   by adding `result`, `error`, and `extraErrors` properties.
 * @param {Boolean} isPostMiddleware - If set to true, the middlewares are treated as post-middleware.
 * @param {Function[]} middlewares - An array of middleware functions with the signature
 *   `function(context)` .
 * @return {Promise} - Resolves with `context`.  Should never reject.  To detect request errors,
 *   check `context.error` .
 **/
function runCallMiddleware(context, isPostMiddleware, middlewares) {
	return pasync.eachSeries(middlewares, (middleware) => {
		if (!isPostMiddleware && (context.result || context.error)) {
			return Promise.resolve();
		}
		let result;
		try {
			result = middleware(context);
		} catch (ex) {
			result = Promise.reject(ex);
		}
		if (!result || !_.isFunction(result.then)) { result = Promise.resolve(result); }
		return result
			.then((result) => {
				if (!isPostMiddleware && result) {
					context.result = result;
				}
			}, (err) => {
				if (isPostMiddleware) {
					if (!context.extraErrors) { context.extraErrors = []; }
					context.extraErrors.push(err);
					console.log('Error in result middleware:', err);
				} else {
					context.error = err || new XError(XError.INTERNAL_ERROR, 'Error in request middleware');
				}
			});
	})
		.then(() => context);
}

module.exports = { wrapExpressMiddleware, runCallMiddleware };
