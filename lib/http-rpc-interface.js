const express = require('express');
const bodyParser = require('body-parser');
const _ = require('lodash');
const XError = require('xerror');
const APIInterface = require('./api-interface');
const utils = require('./utils');

/**
 * API interface for RPC over HTTP.
 *
 * This interface responds to requests in this format:
 *   `POST /v1/rpc/path/to/method` where the method name is `path.to.method` .
 * The POST body should be JSON, in the format: { params: { ... } }.
 * The response is always a HTTP 200, in one of these formats:
 *   { error: { code: ..., message: ..., cause: ..., data: ..., stack: ... } }, or
 *   { result: { ...} }
 *
 * @class HTTPRPCInterface
 * @constructor
 * @param {Object} [options={}]
 *   @param {Boolean} [options.includeErrorStack=false] - Whether to include stack traces in error responses.
 */
class HTTPRPCInterface extends APIInterface {

	constructor(options = {}) {
		super();

		this.options = options;

		// List of middlewares run before the API call
		this.preMiddleware = [];

		// List of middlewares that modify the result or error
		this.postMiddleware = [];

		// Express router
		this.router = express.Router({ caseSensitive: true, strict: false }); // eslint-disable-line new-cap
	}

	registerInterfaceWithRouter(router) {
		router.use('/rpc', this.router);
	}

	register(options, ...middleware) {
		if (!options.method) throw new Error('method is required');

		this.router.post(
			'/' + options.method.replace(/\./g, '/'),
			bodyParser.json({ limit: '1mb' }),
			(req, res) => {
				// Parse the parameters
				let params = {};
				if (req.body && _.isPlainObject(req.body.params)) {
					params = req.body.params;
				}

				// Set up the parameters on the request
				let ctx = req.zapi = {
					method: options.method,
					req,
					res,
					version: options.version,
					params
				};

				// Run pre-middleware
				utils.runCallMiddleware(ctx, false, this.preMiddleware)
					// Run api call middleware
					.then((ctx) => utils.runCallMiddleware(ctx, false, middleware))
					// Run post middleware
					.then((ctx) => utils.runCallMiddleware(ctx, true, this.postMiddleware))
					.then((ctx) => {
						let response = {};

						if (ctx.result) {
							response.result = ctx.result;
						}

						if (ctx.error) {
							if (!XError.isXError(ctx.error)) ctx.error = XError.fromObject(ctx.error);

							response.error = ctx.error.toObject({
								includeStack: this.options.includeErrorStack
							});
						}

						// Send the result object to the client
						res.json(response);
					});
			}
		);
	}

	registerPreMiddleware(options, ...middleware) {
		this.preMiddleware.push(...middleware);
	}

	registerPostMiddleware(options, ...middleware) {
		this.postMiddleware.push(...middleware);
	}

}

module.exports = HTTPRPCInterface;
