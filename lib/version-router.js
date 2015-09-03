const express = require('express');
const APICallRegistrar = require('./api-call-registrar');

/**
 * This class encapsulates an express router for a single version number, and corresponds to a
 * URL like `http://localhost/v3/` .
 *
 * @class VersionRouter
 * @param {Number} version - Version number this router handles
 * @constructor
 */
class VersionRouter extends APICallRegistrar {

	constructor(version) {
		super();
		this.version = version;
		this.router = express.Router({ caseSensitive: true, strict: false });
		this.interfaces = [];
	}

	/**
	 * Returns the Express Router object associated with this class.
	 *
	 * @method getExpressRouter
	 * @return {Router}
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
	 */
	addInterface(apiInterface) {
		apiInterface.registerInterfaceWithRouter(this.router);
		this.interfaces.push(apiInterface);
		return this;
	}

	register(options, ...middleware) {
		options.version = this.version;
		for (let iface of this.interfaces) {
			iface.register(options, ...middleware);
		}
	}

	registerPreMiddleware(options, ...middleware) {
		options.version = this.version;
		for (let iface of this.interfaces) {
			iface.registerPreMiddleware(options, ...middleware);
		}
	}

	registerPostMiddleware(options, ...middleware) {
		options.version = this.version;
		for (let iface of this.interfaces) {
			iface.registerPostMiddleware(options, ...middleware);
		}
	}

}

module.exports = VersionRouter;
