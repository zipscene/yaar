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
	return {
		code: error.code || 'internal_error',
		message: error.message,
		data: error.data,
		cause: error.cause && transformAPIError(error.cause, options),
		id: error.id,
		stack: options.returnStackTrace && error.stack
	};
}

module.exports = transformAPIError;
