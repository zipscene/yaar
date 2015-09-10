const APIInterface = require('./api-interface');
const express = require('express');
const { wrapExpressMiddleware } = require('./utils');
const pasync = require('pasync');
const bodyParser = require('body-parser');
const _ = require('lodash');

/**
 * API interface for RPC over HTTP.  This interface responds to requests in this format:
 * `POST /v1/rpc/path/to/method` where the method name is `path.to.method` .
 * The POST body should be JSON, in the format: { params: { ... } }.
 * The response is always a HTTP 200, in one of these formats:
 * { error: { code: ..., message: ..., cause: ..., data: ..., stack: ... } } or
 * { result: { ...} }
 *
 * @class HTTPRPCInterface
 * @constructor
 * @param {Object} [options={}]
 *   @param {Boolean} [options.includeErrorStack=false] - If set to true, stack traces are included
 *     in error responses.
 */
class HTTPRPCInterface extends APIInterface {

	constructor(options = {}) {
		this.options = options;

		// List of middlewares run before the API call
		this.preMiddleware = [];

		// List of middlewares that modify the result or error
		this.postMiddleware = [];

		// Express router
		this.router = express.Router({ caseSensitive: true, strict: false });
	}

	registerInterfaceWithRouter(router) {
		router.use('/rpc', this.router);
	}

	/**
	 * Converts a single middleware object to Express middleware.  Does not handle error middleware.
	 *
	 * @method _convertMiddlewareToExpress
	 * @private
	 * @param {Object} options - Options passed to the register call
	 * @param {Function} middleware - The single middleware function to convert
	 * @return {Function} - The Express middleware function
	 */
	_convertPreMiddlewareToExpress(options, middleware) {
		return (req, res, next) => {

		};
	}

	/**
	 * Registers one or more middlewares with a given router.  This only applies to middlewares
	 * that can be directly transformed to express middleware (ie, pre middleware and API call
	 * middleware).
	 *
	 * @method _registerMiddleware
	 * @private
	 * @param {Object} options - Any options passed to the corresponding register call
	 * @param {Router} router - The Express router to register it with
	 * @param {Function} ...middleware
	 */
	_registerMiddleware(options, router, ...middleware) {

	}

	register(options, ...middleware) {
		if (!options.method) { throw new Error('method is required'); }
		this.router.post('/' + options.method.replace(/\./g, '/'), bodyParser.json({
			limit: '1mb'
		}), (req, res, next) => {

			// Parse the parameters
			let params;
			if (req.body && _.isPlainObject(req.body.params)) {
				params = req.body.params;
			} else {
				params = {};
			}

			// Set up the parameters on the request
			let context = req.zapi = {
				method: options.method,
				req,
				res,
				version: options.version,
				params
			};

			// Run pre-middleware

			// Run api call middleware

			// Run post middleware

			// Convert context.result or context.error into a result object in the form:
			// { result: context.result } or
			// { error: XError.isXError(context.error) ? context.error.toObject() : XError.fromObject(context.error).toObject() }
			// When calling XError#toObject(), pass in options.includeStack as this.options.includeErrorStack .

			// Send the result object to the client

		});
	}

	registerPreMiddleware(options, ...middleware) {
		this.preMiddleware.push(...middleware);
	}

	registerPostMiddleware(options, ...middleware) {
		this.postMiddleware.push(...middleware);
	}

}
