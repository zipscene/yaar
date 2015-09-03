const pasync = require('pasync');

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

module.exports = { wrapExpressMiddleware };
