const express = require('express');
const bodyParser = require('body-parser');
const _ = require('lodash');
const XError = require('xerror');
const APIInterface = require('./api-interface');
const utils = require('./utils');
const zstreams = require('zstreams');
const pasync = require('pasync');

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
				params,
				routeOptions: options
			};

			// Set up keep-alive
			let keepAlive = null;
			let shouldKeepAlive = (options.keepAlive === undefined) ? true : !!options.keepAlive;
			let keepAliveInterval = options.keepAliveInterval;
			if (!_.isNumber(keepAliveInterval)) keepAliveInterval = 10000;
			let startKeepAlive = () => {
				if (shouldKeepAlive) {
					keepAlive = setInterval(() => {
						res.write(' ');
					}, keepAliveInterval);
				}
			};
			let stopKeepAlive = () => {
				if (keepAlive) {
					clearInterval(keepAlive);
					keepAlive = null;
				}
			};
			let restartKeepAlive = () => {
				stopKeepAlive();
				startKeepAlive();
			};

			if (!options.manualResponse) {
				// Send headers and start keep-alive.
				let contentType = (options.streamingResponse) ? 'text/plain' : 'application/json';
				res.writeHead(200, {
					'Content-type': `${contentType}; charset=utf-8`
				});
				startKeepAlive();
			}

			// Run pre-middleware
			utils.runCallMiddleware(ctx, false, this.preMiddleware)
				// Emit request begin event
				.then((ctx) => {
					return this.apiRouter._triggerRequestBegin(ctx).then(() => ctx);
				})
				// Register event handlers in case of manualResponse
				.then((ctx) => {
					if (options.manualResponse) {
						res.socket.on('end', () => {
							this.apiRouter._triggerRequestEnd(ctx, true).catch(pasync.abort);
						});
						res.socket.on('error', (error) => {
							error = new XError(XError.REQUEST_ERROR, error);
							this.apiRouter._triggerRequestError(ctx, error, true).catch(pasync.abort);
						});
					}
					return ctx;
				})
				// Run api call middleware
				.then((ctx) => utils.runCallMiddleware(ctx, false, middleware))
				// Run post middleware
				.then((ctx) => utils.runCallMiddleware(ctx, true, this.postMiddleware))
				// Process result of the call chain
				.then((ctx) => {
					if (ctx.error) {
						stopKeepAlive();
						this.sendErrorRes(req.body.id, res, ctx.error, false);
						this.apiRouter._triggerRequestEnd(ctx, true).catch(pasync.abort);
					} else if (options.manualResponse) {
						return undefined;
					} else if (options.streamingResponse) {
						let resStream = ctx.result;
						// Duck type the result to ensure it's a stream
						if (!resStream || typeof resStream.pipe !== 'function') {
							return this.sendErrorRes(new XError(
								XError.INTERNAL_ERROR,
								'Expected streaming response route to return a zstream'
							), false);
						}
						resStream = zstreams(resStream);
						let origResStream = resStream;

						// Stream ending and cleanup logic
						let sentFinalResult = false;
						let cleanedUp = false;
						let cleanup = (resError) => {
							if (cleanedUp) return;
							cleanedUp = true;
							stopKeepAlive();
							resStream.unpipe();
							let blackhole = new zstreams.BlackholeStream();
							blackhole.on('chainerror', (error) => {
								console.error('Unexpected error during stream chain cleanup:');
								console.error(error);
							});
							resStream.pipe(blackhole);
							if (options.endStreamOnConnectionClose && !sentFinalResult) {
								// Trigger full zstreams cleanup
								origResStream.abortChain();
							}
							if (resError) {
								this.apiRouter._triggerRequestError(ctx, resError, true).catch(pasync.abort);
							}
						};

						let sendFinalResult = (err) => {
							let dataObj;
							if (sentFinalResult) return;
							sentFinalResult = true;
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
							this.apiRouter._triggerRequestEnd(ctx, true).catch(pasync.abort);
						};

						resStream = resStream.through((chunk) => {
							if (Buffer.isBuffer(chunk)) chunk = chunk.toString();
							if (typeof chunk !== 'string') chunk = JSON.stringify(chunk);
							if (chunk[chunk.length - 1] !== '\n') chunk += '\n';

							restartKeepAlive();

							return chunk;
						});

						// Make sure we're in a clean state if the connection ends
						res.socket.on('error', (error) => {
							cleanup(new XError(XError.REQUEST_ERROR, error));
						});
						res.socket.on('end', () => {
							cleanup(new XError(
								XError.REQUEST_ERROR,
								'Request client hung up unexpectedly'
							));
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

						stopKeepAlive();

						// Send the result object to the client
						res.write(JSON.stringify(response));
						res.end();
						this.apiRouter._triggerRequestEnd(ctx, true).catch(pasync.abort);
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
	 * @param {Boolean=true} sendHeaders - set to false if headers have already been sent.
	 */
	sendErrorRes(id, res, error, sendHeaders = true) {
		if (!XError.isXError(error)) error = XError.fromObject(error);
		let response = { id };
		response.error = error.toObject({
			includeStack: this.options.includeErrorStack,
			extraFields: [ 'id' ]
		});
		response.result = null;

		if (sendHeaders) {
			res.writeHead(200, {
				'Content-type': `application/json; charset=utf-8`
			});
		}

		res.write(JSON.stringify(response));
		res.end();
	}

}

module.exports = JSONRPCInterface;
