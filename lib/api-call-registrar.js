
/**
 * Abstract class implemented by classes to which API calls can be registered.
 *
 * @class APICallRegistrar
 */
class APICallRegistrar {

	/**
	 * Registers an API call with the router.
	 *
	 * @method register
	 * @param {Object} options
	 *   @param {String} options.method - Name of the API call, separated by dots `auth.password` .
	 *   @param {String[]} [options.versions] - Versions this call applies to.  Each string can
	 *     either be a single number, or a range in the form: '3-5' (versions 3 through 5, inclusive),
	 *     '-2' (less than 2, inclusive), or '6-' (greater than 6, inclusive).
	 * @param {Function} ...middleware - API call middleware.  These are in a slightly different format
	 *   than Express middleware.  Each function has the signature: function(request) and returns a Promise.
	 *   If the promise rejects, the middleware chain immediately stops and the error is returned.  If the
	 *   promise resolves with a non-undefined value, the value is returned to the client.  If the promise
	 *   resolves with undefined, the next middleware is executed.
	 *   @param {Object} middleware.request - The only parameter to middleware functions is the "request"
	 *     object, which contains information about the current call.
	 *     @param {Object} middleware.request.params - A map from keys to values containing user-supplied
	 *       API call parameters.
	 *     @param {Request} middleware.request.req - The Express request object.
	 *     @param {Response} middleware.request.res - The Express response object.
	 *     @param {String} middleware.request.version - The API version used to access this call.
	 */
	register(/* options, ...middleware */) {
		throw new Error('Unimplemented');
	}

	/**
	 * Registers middleware that executes before all API calls for this registrar.
	 *
	 * @method registerPreMiddleware
	 * @param {Object} options - Same options as register() but without a name.
	 * @param {Function} ...middleware - Same format as in register() .
	 */
	registerPreMiddleware(/* options, ...middleware */) {
		throw new Error('Unimplemented');
	}

	/**
	 * Registers middleware that executes after API calls return a result or error.
	 *
	 * @method registerPostMiddleware
	 * @param {Object} options - Same options as register() but without a name.
	 * @param {Function} ...middleware - Same format as in register() .  The `request` object has
	 *   the additional properties 'result' and 'error' .
	 */
	registerPostMiddleware(/* options, ...middleware */) {
		throw new Error('Unimplemented');
	}

}

module.exports = APICallRegistrar;
