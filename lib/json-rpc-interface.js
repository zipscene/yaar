// Copyright 2016 Zipscene, LLC
// Licensed under the Apache License, Version 2.0
// http://www.apache.org/licenses/LICENSE-2.0

const express = require('express');
const bodyParser = require('body-parser');
const _ = require('lodash');
const XError = require('xerror');
const APIInterfaceJSONBase = require('./api-interface-json-base');
const APIInterface = require('./api-interface');
const utils = require('./utils');
const zstreams = require('zstreams');
const pasync = require('pasync');
const KeepAlive = require('./keep-alive');
const CrispHooks = require('crisphooks');

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
class JSONRPCInterface extends APIInterfaceJSONBase {

	constructor(options = {}) {
		options.sendHeaderEarly = true;
		super(options);

		// Map of registered methods
		this.methods = {};

		this.router.post('/', bodyParser.json({ limit: '5mb' }), (req, res) => {
			let tmpctx = {
				req,
				res,
				routeOptions: {}
			};
			if (!req.body) {
				tmpctx.error = new XError(XError.BAD_REQUEST, 'no POST body');
				this.sendHeader(tmpctx);
				return this.sendErrorRes(tmpctx);
			}
			if (!req.body.method) {
				tmpctx.error = new XError(XError.BAD_REQUEST, 'no method specified in request');
				this.sendHeader(tmpctx);
				return this.sendErrorRes(tmpctx);
			}
			if (!this.methods[req.body.method] || !_.isFunction(this.methods[req.body.method])) {
				tmpctx.error = new XError(XError.NOT_FOUND, `method: ${req.body.method} doesn't exist`);
				this.sendHeader(tmpctx);
				return this.sendErrorRes(tmpctx);
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

	sendHeader(ctx) {
		// Send headers
		let contentType = (ctx.routeOptions.streamingResponse) ? 'text/plain' : 'application/json';
		ctx.res.writeHead(200, {
			'Content-type': `${contentType}; charset=utf-8`
		});
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
			this.handleAPICall(req, res, options, params, ...middleware);
		};
	}

	sendSuccessRes(ctx) {
		let response = {
			id: ctx.req.body.id,
			error: null,
			result: null
		};
		if (ctx.result) {
			response.result = ctx.result;
		}
		// Send the result object to the client
		ctx.res.end(JSON.stringify(response));
	}

	sendErrorRes(ctx) {
		let error = ctx.error;
		if (!XError.isXError(error)) error = XError.fromObject(error);
		let response = { id: ctx.req && ctx.req.body && ctx.req.body.id };
		response.error = error.toObject({
			includeStack: this.options.includeErrorStack,
			extraFields: [ 'id' ]
		});
		response.result = null;

		ctx.res.end(JSON.stringify(response));
	}
}

module.exports = JSONRPCInterface;
