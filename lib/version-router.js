const express = require('express');
const APICallRegistrar = require('./api-call-registrar');

/**
 * This class encapsulates an express router for a single version number, and corresponds to a
 * URL like `http://localhost/v3/` .
 *
 * @class VersionRouter
 * @constructor
 * @extends APICallRegistrar
 * @param {Number} version - Version number this router handles
 * @constructor
 * @since v1.0.0
 */
class VersionRouter extends APICallRegistrar {

	constructor(version) {
		super();

		this.version = version;
		this.router = express.Router({ caseSensitive: true, strict: false }); // eslint-disable-line new-cap
		this.interfaces = [];

		this.methods = {};
	}

	/**
	 * Returns the Express Router object associated with this class.
	 *
	 * @method getExpressRouter
	 * @return {express.Router}
	 * @since v1.0.0
	 */
	getExpressRouter() {
		return this.router;
	}

	/**
	 * Adds an available API interface for this version.
	 *
	 * @method addInterface
	 * @param {APIInterface} apiInterface
	 * @return {VersionRouter} this
	 * @since v1.0.0
	 */
	addInterface(apiInterface) {
		apiInterface.registerInterfaceWithRouter(this.router);
		this.interfaces.push(apiInterface);
		return this;
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
		options.version = this.version;

		// Keep track of method info
		this.methods[options.method] = options;

		for (let iface of this.interfaces) {
			iface.register(options, ...middleware);
		}
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
		options.version = this.version;
		for (let iface of this.interfaces) {
			iface.registerPreMiddleware(options, ...middleware);
		}
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
		options.version = this.version;
		for (let iface of this.interfaces) {
			iface.registerPostMiddleware(options, ...middleware);
		}
	}

	/**
	 * Returns info for registered routes.
	 *
	 * @method getMethods
	 * @return {Object}
	 * @since v1.0.0
	 */
	getMethods() {
		return this.methods;
	}

}

module.exports = VersionRouter;
