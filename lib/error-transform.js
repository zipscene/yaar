var ZSError = require('zs-error');

// Transforms an error into an error to be returned from the API

function transformAPIError(error, options) {
	if(!options) options = {};
	if(!error) error = {};
	if(typeof error == 'string') {
		return {
			code: 'internal_error',
			message: error
		};
	}
	if(!ZSError.isZSError(error)) {
		error = new ZSError(error.code || ZSError.INTERNAL_ERROR, error.message || 'An error occurred', error.data || undefined, error.cause || undefined);
	}
	return {
		code: error.code || 'internal_error',
		message: error.message || undefined,
		data: error.data || undefined,
		cause: (error.cause && transformAPIError(error.cause, options)) || undefined,
		id: error.id || undefined,
		stack: (options.returnStackTrace && error.stack) || undefined
	};
}

module.exports = transformAPIError;
