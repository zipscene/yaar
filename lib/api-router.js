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
 * @param {Object} [options={}]
 *   @param {Object} [options.versionAliases] - A mapping from version aliases to version numbers.
 *     For example: `{ stable: 4, devel: 5 }`
 *   @param {Boolean} [options.forceSSL=false] - If true, SSL is forced.
 *   @param {String[]} [options.sslExempt] - An array of paths exempt from strict SSL checking.
 *   @param {Boolean} [options.cors=true] - If false, disables CORS support.
 */
class APIRouter extends APICallRegistrar {

	constructor(options = {}) {

		super();

		this.options = options;

		// A map from version numbers to the VersionRouter
		this.versionRouters = {};

		// Router for middleware executed prior to API interfaces
		this.preRouter = express.Router({ caseSensitive: true, strict: false });

		// Router that contains the routes for individual versions
		this.versionsRouter = express.Router({ caseSensitive: true, strict: false });

		// Instantiate the main router that encapsulates the others
		this.mainRouter = express.Router({ caseSensitive: true, strict: false });

		// Add the subrouters to the main router.  Add last-ditch error handlers between each one
		// to handle errors that occur outside of API-call-specific contexts.
		this.mainRouter.use(this.preRouter);
		this.mainRouter.use(APIRouter._lastDitchErrorHandler);
		this.mainRouter.use(this.versionsRouter);
		this.mainRouter.use((req, res, next) => next(new XError(XError.NOT_FOUND, 'Page not found.')) );
		this.mainRouter.use(APIRouter._lastDitchErrorHandler);

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
	 * Returns the VersionRouter corresponding to the version number given.  Creates the
	 * VersionRouter if it doesn't yet exist.
	 *
	 * @method version
	 * @param {Number} versionNum
	 * @return {VersionRouter}
	 */
	version(versionNum) {
		if (this.versionRouters[versionNum]) {
			return this.versionRouters[versionNum];
		}
		let versionRouter = new VersionRouter(versionNum);
		this.versionRouters[versionNum] = versionRouter;
		this.versionsRouter.use('/' + versionNum, versionRouter);
		return versionRouter;
	}

	/**
	 * Returns the express Router which the app should route to for handling API calls.
	 *
	 * @method getExpressRouter
	 * @return {Router}
	 */
	getExpressRouter() {
		return this.mainRouter;
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
	 */
	static _lastDitchErrorHandler(err, req, res, next) {
		res.status(500).send('Error: ' + err.message);
	}

	/**
	 * Returns an array of VersionRouters that match the versions given in callOptions.
	 *
	 * @method _getMatchingVersionRouters
	 * @private
	 * @param {Object} callOptions - Options passed to `register()` .
	 * @return {VersionRouter[]}
	 */
	_getMatchingVersionRouters(callOptions) {
		// No versions specified -> all versions
		if (!callOptions.versions) {
			return _.values(this.versionRouters);
		}
		// Filter by version keys that match
		return _.filter(
			this.versionRouters,
			(versionRouter, version) => expressionMatchesVersion(callOptions.versions, +version)
		);
	}

	register(options, ...middleware) {
		_.forEach(this._getMatchingVersionRouters(options), (versionRouter) => {
			versionRouter.register(options, ...middleware);
		});
	}

	registerPreMiddleware(options, ...middleware) {
		_.forEach(this._getMatchingVersionRouters(options), (versionRouter) => {
			versionRouter.registerPreMiddleware(options, ...middleware);
		});
	}

	registerPostMiddleware(options, ...middleware) {
		_.forEach(this._getMatchingVersionRouters(options), (versionRouter) => {
			versionRouter.registerPostMiddleware(options, ...middleware);
		});
	}

}

module.exports = APIRouter;
