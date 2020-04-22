// Copyright 2016 Zipscene, LLC
// Licensed under the Apache License, Version 2.0
// http://www.apache.org/licenses/LICENSE-2.0

const express = require('express');
const bodyParser = require('body-parser');
const _ = require('lodash');
const XError = require('xerror');
const APIInterface = require('./api-interface');
const utils = require('./utils');
const zstreams = require('zstreams');
const pasync = require('pasync');
const KeepAlive = require('./keep-alive');
const CrispHooks = require('crisphooks');

/**
 * API interface base class for APIs with JSON responses.  Contains utility methods for such APIs.
 *
 * @class APIInterfaceJSONBase
 * @constructor
 * @extends APIInterface
 * @param {Object} [options={}]
 *   @param {Boolean} [options.includeErrorStack=false] - Whether to include stack traces in error responses.
 *   @param {Boolean} [options.sendHeaderEarly] - If true, sends the header before executing call middleware.  This
 *     means that the header cannot depend on the middleware results.  It is required for keepalive.
 */
class APIInterfaceJSONBase extends APIInterface {

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

	sendHeader(ctx) {
		// Send the HTTP response header
	}

	/**
	 * Called to handle an API call, and returning the response, after parameters have been parsed.
	 *
	 * Note: This function returns immediately but continues to handle the API call.
	 *
	 * @method handleAPICall
	 * @param {Request} req
	 * @param {Response} res
	 * @param {Object} options - register() options
	 * @param {Object} params - Parsed parameters to method
	 * @param {Function...} middleware
	 */
	handleAPICall(req, res, options, params, ...middleware) {
		// Set up the parameters on the request
		let ctx = req.zapi = {
			method: options.method,
			req,
			res,
			version: options.version,
			params,
			routeOptions: options
		};

		// Because multiple API calls can use the same socket (HTTP keepalive), we need
		// to remove any previous socket handlers added by yaar before adding new ones.
		let eventNames = [ 'close', 'error', 'timeout', 'end' ];
		for (let eventName of eventNames) {
			for (let listener of res.socket.listeners(eventName)) {
				if (listener._isYaarHandler) {
					res.socket.removeListener(eventName, listener);
				}
			}
		}

		// Add 'connection-closed' hook to ctx.
		CrispHooks.addHooks(ctx);
		let connectionClosedTriggered = false;
		const triggerConnectionClosed = () => {
			if (!connectionClosedTriggered) {
				connectionClosedTriggered = true;
				ctx.trigger('connection-closed').catch(pasync.abort);
			}
		};
		triggerConnectionClosed._isYaarHandler = true;
		res.on('close', triggerConnectionClosed);
		res.socket.on('error', triggerConnectionClosed);
		res.socket.on('timeout', triggerConnectionClosed);

		// Set up keep-alive
		let keepAlive = null;
		if (
			(options.keepAlive === undefined || !!options.keepAlive) &&
			!options.manualResponse &&
			this.options.sendHeaderEarly
		) {
			keepAlive = new KeepAlive(res, options.keepAliveInterval);
		}

		if (!options.manualResponse && this.options.sendHeaderEarly) {
			this.sendHeader(ctx);
			// Start keep-alive.
			if (keepAlive) keepAlive.start();
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
					const socketEndHandler = () => {
						this.apiRouter._triggerRequestEnd(ctx, true).catch(pasync.abort);
					};
					socketEndHandler._isYaarHandler = true;
					const socketErrorHandler = (err) => {
						err = new XError(XError.REQUEST_ERROR, err);
						this.apiRouter._triggerRequestError(ctx, err, true).catch(pasync.abort);
					};
					socketErrorHandler._isYaarHandler = true;
					res.socket.on('end', socketEndHandler);
					res.socket.on('error', socketErrorHandler);
				}
				return ctx;
			})
			// Run api call middleware
			.then((ctx) => utils.runCallMiddleware(ctx, false, middleware))
			// Run post middleware
			.then((ctx) => utils.runCallMiddleware(ctx, true, this.postMiddleware))
			// Process result of the call chain
			.then((ctx) => {
				// Send header
				if (!options.manualResponse && !this.options.sendHeaderEarly) {
					this.sendHeader(ctx);
				}

				if (ctx.error) {
					if (keepAlive) keepAlive.stop();
					this.apiRouter._triggerRequestEnd(ctx, true).catch(pasync.abort);
					if (options.streamingResponse) {
						this.sendStreamEnd(res, ctx.error);
					} else {
						this.sendErrorRes(ctx);
					}
				} else if (options.manualResponse) {
					return undefined;
				} else if (options.streamingResponse) {
					res.socket.setTimeout(0);

					let resStream = ctx.result;
					// Duck type the result to ensure it's a stream
					if (!resStream || typeof resStream.pipe !== 'function') {
						ctx.error = new XError(
							XError.INTERNAL_ERROR,
							'Expected streaming response route to return a zstream'
						);
						this.sendErrorRes(ctx);
					}
					resStream = zstreams(resStream);
					let origResStream = resStream;

					// Stream ending and cleanup logic
					let sentFinalResult = false;
					let cleanedUp = false;
					let cleanup = (resError) => {
						if (cleanedUp) return;
						cleanedUp = true;
						if (keepAlive) keepAlive.stop();
						resStream.unpipe();
						let blackhole = new zstreams.BlackholeStream();
						blackhole.on('chainerror', (error) => {
							console.error('Unexpected error during stream chain cleanup:');
							console.error(error);
						});
						resStream.pipe(blackhole);
						if (!sentFinalResult) {
							// Trigger full zstreams cleanup
							origResStream.abortChain();
						}
						if (resError) {
							this.apiRouter._triggerRequestError(ctx, resError, true).catch(pasync.abort);
						}
					};

					let sendFinalResult = (err) => {
						if (sentFinalResult) return;
						sentFinalResult = true;
						cleanup();
						this.apiRouter._triggerRequestEnd(ctx, true).catch(pasync.abort);
						this.sendStreamEnd(res, err);
					};

					resStream = resStream.through((chunk) => {
						if (Buffer.isBuffer(chunk)) chunk = chunk.toString();
						if (typeof chunk !== 'string') chunk = JSON.stringify(chunk);
						if (chunk[chunk.length - 1] !== '\n') chunk += '\n';

						// Restart keep-alive timer.
						if (keepAlive) keepAlive.start();

						return chunk;
					});

					// Make sure we're in a clean state if the connection ends
					const streamingSocketErrorHandler = (error) => cleanup(new XError(XError.REQUEST_ERROR, error));
					streamingSocketErrorHandler._isYaarHandler = true;
					const streamingSocketEndHandler = () => cleanup(
						new XError(XError.REQUEST_ERROR, 'Request client hung up unexpectedly')
					);
					streamingSocketEndHandler._isYaarHandler = true;
					res.socket.on('error', streamingSocketErrorHandler);
					res.socket.on('end', streamingSocketEndHandler);

					resStream.on('end', () => sendFinalResult());
					resStream.on('chainerror', function(err) {
						// Prevent zstreams default cleanup, otherwise res will be ended
						// before the final success/failure object can be sent.
						this.ignoreError();
						sendFinalResult(err);
					});
					resStream.pipe(res, { end: false });

				} else { // success
					if (ctx.result && options.responseSchema) {
						// Normalize to response schema
						ctx.result = options.responseSchema.normalize(ctx.result, options.normalizeOptions);
					}
					if (keepAlive) keepAlive.stop();
					this.apiRouter._triggerRequestEnd(ctx, true).catch(pasync.abort);
					this.sendSuccessRes(ctx);
				}
			})
			.catch(pasync.abort);

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
	 */
	sendErrorRes(ctx) {
		// Override me
	}

	sendSuccessRes(ctx) {
	}

	/**
	 * Send object indicating success/failure for streaming response, and end response.
	 * @method sendStreamEnd
	 * @param {Object} res - express response object
	 * @param {object} error - error object, if any.
	 */
	sendStreamEnd(res, error) {
		let dataObj;
		if (error) {
			dataObj = {
				success: false,
				error: this.formatErrorResponse(error)
			};
		} else {
			dataObj = { success: true };
		}
		res.end(
			JSON.stringify(dataObj) + '\n',
			'utf8'
		);
	}

	formatErrorResponse(error) {
		if (!XError.isXError(error)) error = XError.fromObject(error);
		return error.toObject({
			includeStack: this.options.includeErrorStack,
			extraFields: [ 'id' ]
		});
	}

}

module.exports = APIInterfaceJSONBase;
