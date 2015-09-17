const express = require('express');
const _ = require('lodash');
const XError = require('xerror');
const cors = require('cors');
const APICallRegistrar = require('./api-call-registrar');
const VersionRouter = require('./version-router');
const { expressionMatchesVersion } = require('./version-match');

/**
 * Main class for an API router.  Normally, an application will instantiate one of these and register
 * routes to it.
 *
 * @class APIRouter
 * @constructor
 * @extends APICallRegistrar
 * @param {Object} [options={}]
 *   @param {Object} [options.versionAliases] - A mapping from version aliases to version numbers.
 *     For example: `{ stable: 4, devel: 5 }`
 *   @param {Boolean} [options.forceSSL=false] - If true, SSL is forced.
 *   @param {String[]} [options.sslExempt] - An array of paths exempt from strict SSL checking.
 *   @param {Boolean} [options.cors=true] - If false, disables CORS support.
 * @throws XError
 * @since v0.0.1
 */
class APIRouter extends APICallRegistrar {

	constructor(options = {}) {
		super();

		this.options = options;

		// A map from version numbers to the VersionRouter
		this.versionRouters = {};

		// Router for middleware executed prior to API interfaces
		this.preRouter = express.Router({ caseSensitive: true, strict: false }); // eslint-disable-line new-cap

		// Router that contains the routes for individual versions
		this.versionsRouter = express.Router({ caseSensitive: true, strict: false }); // eslint-disable-line new-cap

		// Instantiate the main router that encapsulates the others
		this.router = express.Router({ caseSensitive: true, strict: false }); // eslint-disable-line new-cap

		// Add the subrouters to the main router.  Add last-ditch error handlers between each one
		// to handle errors that occur outside of API-call-specific contexts.
		this.router.use(this.preRouter);
		this.router.use(APIRouter._lastDitchErrorHandler);
		this.router.use(this.versionsRouter);
		this.router.use((req, res, next) => next(new XError(XError.NOT_FOUND, 'Page not found.')) );
		this.router.use(APIRouter._lastDitchErrorHandler);

		// Check for forcing SSL
		if (options.forceSSL) {
			this.preRouter.use((req, res, next) => {
				if (req.secure || _.includes(options.sslExempt || [], req.url)) {
					next();
				} else {
					next(new XError(XError.BAD_REQUEST, 'HTTPS is required for this request.'));
				}
			});
		}

		// Allow CORS
		if (options.cors !== false) {
			this.preRouter.use(cors({
				methods: [ 'GET', 'POST', 'PUT', 'DELETE' ],
				headers: [ 'Content-type', 'Authorization' ]
			}));
		}
	}

	/**
	 * Returns the VersionRouter corresponding to the version number given.
	 * Creates the VersionRouter if it does not yet exist.
	 *
	 * @method version
	 * @param {Number|String} version
	 * @return {VersionRouter}
	 * @since v0.0.1
	 */
	version(version) {
		if (this.versionRouters[version]) return this.versionRouters[version];

		let versionRouter = new VersionRouter(version);
		this.versionRouters[version] = versionRouter;
		this.versionsRouter.use(`/v${version}`, versionRouter.getExpressRouter());
		return versionRouter;
	}

	/**
	 * Returns the express Router which the app should route to for handling API calls.
	 *
	 * @method getExpressRouter
	 * @return {express.Router}
	 * @since v0.0.1
	 */
	getExpressRouter() {
		return this.router;
	}

	/**
	 * Returns an array of VersionRouters that match the versions given in callOptions.
	 *
	 * @method _getMatchingVersionRouters
	 * @private
	 * @param {Object} callOptions - Options passed to `register()` .
	 * @return {VersionRouter[]}
	 * @since v0.0.1
	 */
	_getMatchingVersionRouters(callOptions) {
		// No versions specified -> all versions
		if (!callOptions.versions) return _.values(this.versionRouters);

		// Filter by version keys that match
		return _.filter(
			this.versionRouters,
			(versionRouter, version) => expressionMatchesVersion(callOptions.versions, +version)
		);
	}

	/**
	 * Registers an API call with the router.
	 * See parent class for detailed documentation
	 *
	 * @method register
	 * @param {Object} options
	 * @param {Function} ...middleware
	 * @since v0.0.1
	 */
	register(options, ...middleware) {
		_.forEach(this._getMatchingVersionRouters(options), (versionRouter) => {
			versionRouter.register(options, ...middleware);
		});
	}

	/**
	 * Registers middleware that executes before all API calls for this registrar.
	 * See parent class for detailed documentation
	 *
	 * @method registerPreMiddleware
	 * @param {Object} options
	 * @param {Function} ...middleware
	 * @since v0.0.1
	 */
	registerPreMiddleware(options, ...middleware) {
		_.forEach(this._getMatchingVersionRouters(options), (versionRouter) => {
			versionRouter.registerPreMiddleware(options, ...middleware);
		});
	}

	/**
	 * Registers middleware that executes after API calls return a result or error.
	 * See parent class for detailed documentation
	 *
	 * @method registerPostMiddleware
	 * @param {Object} options
	 * @param {Function} ...middleware
	 * @since v0.0.1
	 */
	registerPostMiddleware(options, ...middleware) {
		_.forEach(this._getMatchingVersionRouters(options), (versionRouter) => {
			versionRouter.registerPostMiddleware(options, ...middleware);
		});
	}

	/**
	 * Express middleware to use as a last-ditch error handler outside of any API interface-specific
	 * formats or handling.
	 *
	 * @method _lastDitchErrorHandler
	 * @static
	 * @param {Mixed} err
	 * @param {Request} req
	 * @param {Response} res
	 * @param {Function} next
	 * @since v0.0.1
	 */
	static _lastDitchErrorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
		res.status(500).send(`Error: ${err.message}`);
	}

}

module.exports = APIRouter;
