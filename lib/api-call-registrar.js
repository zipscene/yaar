// Copyright 2016 Zipscene, LLC
// Licensed under the Apache License, Version 2.0
// http://www.apache.org/licenses/LICENSE-2.0


/**
 * Abstract class implemented by classes to which API calls can be registered.
 *
 * @class APICallRegistrar
 * @constructor
 * @since v1.0.0
 */
class APICallRegistrar {

	/**
	 * Registers an API call with the router.
	 *
	 * @method register
	 * @param {Object} options
	 *   @param {String} options.method - Name of the API call, separated by dots `auth.password` .
	 *   @param {Array{Number|String}} [options.versions] - Versions this call applies to.
	 *     Each item can either be a single number, or a range in the form:
	 *       '3-5' (versions 3 through 5, inclusive),
	 *       '-2' (less than 2, inclusive), or
	 *       '6-' (greater than 6, inclusive)
	 *   @param {Boolean} [options.manualResult=false]
	 * @param {Function} ...middleware - API call middleware.
	 *   These are in a slightly different format than Express middleware.
	 *   Each function has the signature: function(ctx) and returns a Promise.
	 *   If the promise rejects, the middleware chain immediately stops and the error is returned.
	 *   If the promise resolves with a non-undefined value, the value is returned to the client.
	 *   If the promise resolves with undefined, the next middleware is executed.
	 *   @param {Object} middleware.ctx - The only parameter to middleware functions is the "ctx"
	 *     object, which contains information about the current call.
	 *     @param {Object} middleware.ctx.params - A map from keys to values containing user-supplied
	 *       API call parameters.
	 *     @param {Request} middleware.ctx.req - The Express request object.
	 *     @param {Response} middleware.ctx.res - The Express response object.
	 *     @param {String} middleware.ctx.version - The API version used to access this call.
	 * @since v1.0.0
	 */
	register(/* options, ...middleware */) {
		throw new Error('Unimplemented');
	}

	/**
	 * Registers middleware that executes before all API calls for this registrar.
	 * If these resolve with a value, that value is set as the result of the API call.
	 * If these reject, that becomes the API call error.
	 * If any resolve or reject, further middleware is not executed, and the API call middleware is not executed.
	 *
	 * @method registerPreMiddleware
	 * @param {Object} options - Same options as register() but without a name.
	 * @param {Function} ...middleware - Same format as in register() .
	 * @since v1.0.0
	 */
	registerPreMiddleware(/* options, ...middleware */) {
		throw new Error('Unimplemented');
	}

	/**
	 * Registers middleware that executes after API calls return a result or error.
	 * If these resolve with a result, the value is ignored.
	 * If these reject, the error is logged, but is ignored.
	 *
	 * @method registerPostMiddleware
	 * @param {Object} options - Same options as register() but without a name.
	 * @param {Function} ...middleware - Same format as in register().
	 *   The `ctx` object has the additional properties 'result' and 'error' .
	 * @since v1.0.0
	 */
	registerPostMiddleware(/* options, ...middleware */) {
		throw new Error('Unimplemented');
	}

}

module.exports = APICallRegistrar;
