const APIInterface = require('./api-interface');
const express = require('express');
const { wrapExpressMiddleware } = require('./utils');
const pasync = require('pasync');
const bodyParser = require('body-parser');

/**
 * API interface for RPC over HTTP.
 *
 * @class HTTPRPCInterface
 * @constructor
 */
class HTTPRPCInterface extends APIInterface {

	constructor() {
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
			// Parse parameters

			// Set up the parameters on the request
			req.zapi = {
				method: options.method,
				req,
				res,
				version: options.version,
				params:
			};


		});
	}

	registerPreMiddleware(options, ...middleware) {
		this.preMiddleware.push(...middleware);
	}

	registerPostMiddleware(options, ...middleware) {
		this.postMiddleware.push(...middleware);
	}

}
