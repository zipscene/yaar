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
const objtools = require('objtools');

/**
 * API interface for REST.
 *
 * @class RESTSimpleInterface
 * @constructor
 * @extends APIInterfaceJSONBase
 * @param {Object} [options={}]
 *   @param {Boolean} [options.includeErrorStack=false] - Whether to include stack traces in error responses.
 * @since v1.0.0
 */
class RESTSimpleInterface extends APIInterfaceJSONBase {

	constructor(options = {}) {
		super(options);

		// Map of registered methods
		this.methods = {};
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
		router.use('/rest', this.router);
	}

	sendHeader(ctx) {
		// Send headers
		let contentType = (ctx.routeOptions.streamingResponse && !ctx.error) ? 'text/plain' : 'application/json';
		let statusCode = 200;
		if (ctx.error) {
			if (XError.isXError(ctx.error)) {
				statusCode = (XError.getErrorCode(ctx.error.code) || {}).http || 500;
			} else {
				statusCode = 500;
			}
		}
		ctx.res.writeHead(statusCode, {
			'Content-type': `${contentType}; charset=utf-8`
		});
	}

	/**
	 * This is called for any REST request.
	 */
	_mainRESTMiddleware(req, res, next) {
		let pathComponents = req.path.replace(/^\//, '').replace(/\/\//g, '/').split('/');
		let body = (req.body && _.isPlainObject(req.body)) ? req.body : {};

		const getQueryParam = (name) => {
			let str = req.query && req.query[name];
			if (str) {
				try {
					return JSON.parse(str);
				} catch (err) {
					return str;
				}
			} else {
				return undefined;
			}
		};

		const findObjectOperationMethod = (methodSuffix) => {
			for (let i = pathComponents.length - 1; i >= 1; i--) {
				let methodName = pathComponents.slice(0, i).join('.') + '.' + methodSuffix;
				if (this.methods[methodName] && this.methods[methodName].options.model) {
					// Make sure the number of path keys and model keys matches
					let modelKeys = this.methods[methodName].options.model.getKeys();
					if (modelKeys.length === pathComponents.length - i) {
						// Construct a keys object
						let keys = {};
						for (let j = 0; j < modelKeys.length; j++) {
							keys[modelKeys[j]] = pathComponents[i + j];
						}
						// Return the results
						return {
							method: methodName,
							keys
						};
					}
				}
			}
			return null;
		};


		if (req.method === 'POST') {
			// As a POST, this is either an object creation, or a method call.
			// First check if there's a corresponding method call.
			let methodName = pathComponents.join('.');
			if (this.methods[methodName]) {
				// A method exists by that name, so treat this as a method call
				let methodParams = (req.body && _.isPlainObject(req.body)) ? req.body : {};
				let methodMiddleware = this.methods[methodName].middleware;
				this.handleAPICall(req, res, this.methods[methodName].options, methodParams, ...methodMiddleware);
				return;
			}

			// Check if there's a corresponding put method for object creation (handled same as object replacement)
			methodName = pathComponents.join('.') + '.put';
			if (this.methods[methodName]) {
				// A corresponding put method exists, so call it with the given data
				let methodParams = {
					data: body
				};
				let methodMiddleware = this.methods[methodName].middleware;
				this.handleAPICall(req, res, this.methods[methodName].options, methodParams, ...methodMiddleware);
				return;
			}
		}

		if (req.method === 'GET') {
			// This is either a get on an individual object, or a get on an object root (a list)
			// First check if it fits the pattern for a get on a single object
			// Because objects can have multiple keys, multiple route prefixes need to be checked
			let so = findObjectOperationMethod('get');
			if (so) {
				// Run get on single object
				let methodParams = {
					keys: so.keys,
					fields: getQueryParam('fields')
				};
				let methodMiddleware = this.methods[so.method].middleware;
				this.handleAPICall(req, res, this.methods[so.method].options, methodParams, ...methodMiddleware);
				return;
			}

			// Check for GET on object root (list/query)
			let methodName = pathComponents.join('.') + '.query';
			if (this.methods[methodName]) {
				let methodParams = {
					query: getQueryParam('query') || {},
					fields: getQueryParam('fields'),
					sort: getQueryParam('sort'),
					skip: getQueryParam('skip'),
					limit: getQueryParam('limit')
				};
				let methodMiddleware = this.methods[methodName].middleware;
				this.handleAPICall(req, res, this.methods[methodName].options, methodParams, ...methodMiddleware);
				return;
			}
			methodName = pathComponents.join('.') + '.list';
			if (this.methods[methodName]) {
				let methodParams = {
					fields: getQueryParam('fields'),
					sort: getQueryParam('sort'),
					skip: getQueryParam('skip'),
					limit: getQueryParam('limit')
				};
				let methodMiddleware = this.methods[methodName].middleware;
				this.handleAPICall(req, res, this.methods[methodName].options, methodParams, ...methodMiddleware);
				return;
			}

		}

		if (req.method === 'PUT') {
			// Check for a put to an object path
			let so = findObjectOperationMethod('put');
			if (so) {
				let data = body;
				// Copy keys to the body
				for (let key in so.keys) {
					objtools.setPath(data, key, so.keys[key]);
				}
				// Run the method
				let methodParams = { data };
				let methodMiddleware = this.methods[so.method].middleware;
				this.handleAPICall(req, res, this.methods[so.method].options, methodParams, ...methodMiddleware);
				return;

			}
		}

		if (req.method === 'DELETE') {
			let so = findObjectOperationMethod('delete');
			if (so) {
				let methodParams = {
					query: so.keys
				};
				let methodMiddleware = this.methods[so.method].middleware;
				this.handleAPICall(req, res, this.methods[so.method].options, methodParams, ...methodMiddleware);
				return;
			}
		}

		// Nothing handled.
		next();
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
		this.methods[options.method] = {
			options,
			middleware
		};

		const getObjectRootRoutePath = () => {
			return '/' + options.method.split('.').slice(0, -1).join('/');
		};

		const getObjectRoutePath = () => {
			let path = getObjectRootRoutePath();
			let keyFields = options.model.getKeys();
			for (let field of keyFields) {
				field = field.replace(/\./g, '');
				path += '/:' + field;
			}
			return path;
		};

		// Register route to handle this method as a POST to the method
		this.router.post(
			'/' + options.method.replace(/\./g, '/'),
			bodyParser.json({ limit: '5mb' }),
			this._mainRESTMiddleware.bind(this)
		);

		if (/\.get$/.test(options.method) && options.model) {
			// Get object
			// Register route to handle GET on object path (get object)
			this.router.get(
				getObjectRoutePath(),
				this._mainRESTMiddleware.bind(this)
			);
		} else if (/\.put$/.test(options.method) && options.model) {
			// Replace object
			// Register route to handle PUT on object path
			this.router.put(
				getObjectRoutePath(),
				bodyParser.json({ limit: '5mb' }),
				this._mainRESTMiddleware.bind(this)
			);
			// Register route to handle POST on object root (create new)
			this.router.post(
				getObjectRootRoutePath(),
				bodyParser.json({ limit: '5mb' }),
				this._mainRESTMiddleware.bind(this)
			);
		} else if (/\.delete$/.test(options.method) && options.model) {
			// Delete object
			// Register route to handle DELETE on object path
			this.router.delete(getObjectRoutePath(), this._mainRESTMiddleware.bind(this));
		} else if (/\.(query|list)$/.test(options.method) && options.model) {
			// Register route to handle GET on object root (list objects)
			this.router.get(getObjectRootRoutePath(), this._mainRESTMiddleware.bind(this));
		}
	}

	sendSuccessRes(ctx) {
		// Send the result object to the client
		ctx.res.end(JSON.stringify(ctx.result || null));
	}

	sendErrorRes(ctx) {
		let error = ctx.error;
		if (!XError.isXError(error)) error = XError.fromObject(error);
		let response = error.toObject({
			includeStack: this.options.includeErrorStack,
			extraFields: [ 'id' ]
		});
		ctx.res.end(JSON.stringify(response));
	}
}

module.exports = RESTSimpleInterface;

