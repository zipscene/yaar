const express = require('express');
const bodyParser = require('body-parser');
const _ = require('lodash');
const XError = require('xerror');
const APIInterface = require('./api-interface');
const utils = require('./utils');
const zstreams = require('zstreams');

/**
 * API interface for JSON RPC over HTTP.
 *
 * This interface responds to requests in this format:
 *   `POST /v1/jsonrpc`.
 * The POST body should be JSON, in the format: { id: Number, method: String, params: { ... } }.
 * The response is always a HTTP 200, in one of these formats:
 *   { error: { code: ..., message: ..., cause: ..., data: ..., stack: ... } }, or
 *   { result: { ...} }
 *
 * @class JSONRPCInterface
 * @constructor
 * @extends APIInterface
 * @param {Object} [options={}]
 *   @param {Boolean} [options.includeErrorStack=false] - Whether to include stack traces in error responses.
 * @since v1.0.0
 */
class JSONRPCInterface extends APIInterface {

	constructor(options = {}) {
		super();

		this.options = options;

		// List of middlewares run before the API call
		this.preMiddleware = [];

		// List of middlewares that modify the result or error
		this.postMiddleware = [];

		// Map of registered methods
		this.methods = {};

		// Express router
		this.router = express.Router({ caseSensitive: true, strict: false }); // eslint-disable-line new-cap

		this.router.post('/', bodyParser.json({ limit: '1mb' }), (req, res) => {
			if (!req.body) {
				return this.sendErrorRes(null, res, new XError(XError.BAD_REQUEST, `no POST body`));
			}
			let id = req.body.id || null;
			if (!req.body.method) {
				return this.sendErrorRes(id, res, new XError(XError.BAD_REQUEST, `no method specified in request`));
			}
			if (!this.methods[req.body.method] || !_.isFunction(this.methods[req.body.method])) {
				let error = new XError(XError.NOT_FOUND, `method: ${req.body.method} doesn't exist`);
				return this.sendErrorRes(id, res, error);
			}

			return this.methods[req.body.method](req, res);
		});
	}

	/**
	 * Given an Express router, registers this interface to handle its portion of API calls from the router.
	 * See parent class for detailed documentation
	 *
	 * @method registerInterfaceWithRouter
	 * @param {express.Router} router
	 * @since v1.0.0
	 */
	registerInterfaceWithRouter(router) {
		router.use('/jsonrpc', this.router);
	}

	/**
	 * Registers an API call with the router.
	 * See parent class for detailed documentation
	 *
	 * @method register
	 * @param {Object} options
	 * @param {Function} ...middleware
	 * @since v1.0.0
	 */
	register(options, ...middleware) {
		if (!options.method) throw new XError('method is required');

		this.methods[options.method] = (req, res) => {
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
					if (ctx.error) return this.sendErrorRes(req.body.id, res, ctx.error);
					if (options.manualResponse) {
						return undefined;
					} else if (options.streamingResponse) {
						let resStream = ctx.result;
						// Duck type the result to ensure it's a stream
						if (!resStream || resStream._isZStream !== true) {
							return this.sendErrorRes(new XError(
								XError.INTERNAL_ERROR,
								'Expected streaming response route to return a zstream'
							));
						}
						let origResStream = resStream;

						// Stream ending and cleanup logic
						let streamKeepAlive = !!options.streamKeepAlive;
						let cleanedUp = false;
						let cleanup = () => {
							if (cleanedUp) return;
							cleanedUp = true;
							streamKeepAlive = false;
							if (options.endStreamOnConnectionClose) {
								// Emit error to trigger full zstreams cleanup
								origResStream.emit('error');
							}
						};

						let sentFinalResult = false;
						let sendFinalResult = (err) => {
							let dataObj;
							if (sentFinalResult) return;
							sentFinalResult = true;
							resStream.unpipe();
							resStream.pipe(new zstreams.BlackholeStream());
							cleanup();
							if (err) {
								dataObj = {
									success: false,
									error: { code: err.code, message: err.message }
								};
							} else {
								dataObj = { success: true };
							}
							res.end(
								JSON.stringify(dataObj) + '\n',
								'utf8'
							);
						};

						let wroteHead = false;
						resStream = resStream.through((chunk) => {
							if (!wroteHead) {
								wroteHead = true;
								res.writeHead(200, {
									'Content-type': 'text/plain'
								});
							}
							if (Buffer.isBuffer(chunk)) chunk = chunk.toString();
							if (typeof chunk !== 'string') chunk = JSON.stringify(chunk);
							if (chunk[chunk.length - 1] !== '\n') chunk += '\n';
							return chunk;
						});

						// Optionally run a keepalive loop
						let keepAliveLoop = () => {
							if (!streamKeepAlive) return;
							setTimeout(() => {
								resStream.write(
									{ streamKeepAlive: true }
								);
								keepAliveLoop();
							}, 1000);
						}
						keepAliveLoop();

						// Make sure we're in a clean state if the connection ends
						req.socket.on('error', (error) => {
							cleanup();
						});
						req.socket.on('close', () => {
							cleanup();
						});
						res.socket.on('error', (error) => {
							cleanup();
						});
						res.socket.on('close', () => {
							cleanup();
						});

						resStream.on('end', () => sendFinalResult());
						resStream.on('chainerror', (err) => sendFinalResult(err));
						resStream.pipe(res, { end: false });

					} else {
						let response = {
							id: req.body.id,
							error: null,
							result: null
						};

						if (ctx.result) {
							response.result = ctx.result;

							// Normalize to schema if one was specified
							if (options.responseSchema) {
								response.result = options.responseSchema.normalize(
									response.result,
									options.normalizeOptions
								);
							}
						}

						// Send the result object to the client
						res.status(200).json(response);
					}
				});
		};
	}

	/**
	 * Registers middleware that executes before all API calls for this registrar.
	 * See parent class for detailed documentation
	 *
	 * @method registerPreMiddleware
	 * @param {Object} options
	 * @param {Function} ...middleware
	 * @since v1.0.0
	 */
	registerPreMiddleware(options, ...middleware) {
		this.preMiddleware.push(...middleware);
	}

	/**
	 * Registers middleware that executes after API calls return a result or error.
	 * See parent class for detailed documentation
	 *
	 * @method registerPostMiddleware
	 * @param {Object} options
	 * @param {Function} ...middleware
	 * @since v1.0.0
	 */
	registerPostMiddleware(options, ...middleware) {
		this.postMiddleware.push(...middleware);
	}

	/**
	 * Send response with error
	 * @method sendErrorRes
	 * @param {string} id - request id
	 * @param {Object} res - express response object
	 * @param {object} error - error object
	 */
	sendErrorRes(id, res, error) {
		if (!XError.isXError(error)) error = XError.fromObject(error);
		let response = { id };
		response.error = error.toObject({
			includeStack: this.options.includeErrorStack
		});
		response.result = null;
		return res.status(200).json(response);
	}

}

module.exports = JSONRPCInterface;
