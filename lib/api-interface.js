const APICallRegistrar = require('./api-call-registrar');

/**
 * Code to transform a request/response to a common format for API calls.
 * This is a base class, and should be subclassed.
 *
 * @class APIInterface
 * @constructor
 * @extends APICallRegistrar
 * @since v1.0.0
 */
class APIInterface extends APICallRegistrar {

	/**
	 * Given an Express router, registers this interface to handle its portion of API calls from the router.
	 * Typically, the router will correspond to the API base URL (like `http://localhost/v3/`).
	 *
	 * @method registerInterfaceWithRouter
	 * @param {express.Router} router - The Express Router object
	 * @since v1.0.0
	 */
	registerInterfaceWithRouter(/* router */) {
		throw new Error('Unimplemented');
	}

}

module.exports = APIInterface;
