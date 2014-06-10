var express = require('express');
var ZSError = require('zs-error');
var transformError = require('./error-transform');
var parseRegisterArgs = require('./parse-register-args');

function RestRouter(options) {
	if(!options) options = {};

	function jsonStringify(val) {
		if(options.prettyJSON) {
			return JSON.stringify(val, null, '\t');
		} else {
			return JSON.stringify(val);
		}
	}

	// Create an express router to use for the actual REST API call routes
	this.apiCallRouter = express.Router({
		caseSensitive: true,
		strict: true
	});

	// Create an express router to use for postprocessing API errors
	this.postAPIRouter = express.Router({});

	// This express router wraps the other sub-routers for REST
	this.mainRouter = express.Router({
		caseSensitive: true,
		strict: true
	});

	// Set up the request and response objects as a REST API request/response
	this.mainRouter.use(function(req, res, next) {
		// Always return JSON
		res.set('Content-type', 'application/json');

		// Redefine the req.param method to pull from REST parameters
		req.origParam = req.param;
		req.param = function(name) {
			if(req.body && req.body[name]) return req.body[name];
			return req.origParam(name);
		};

		// Set a res.result method to return a result
		res.result = function(result) {
			if(result === undefined) result = { success: true };
			res.send(jsonStringify(result));
		};

		next();
	});

	// Run the request through the API call router
	this.mainRouter.use(this.apiCallRouter);

	// If any request was not matched by the API call router, send a 404 error
	this.mainRouter.use(function(req, res, next) {
		next(new ZSError(ZSError.NOT_FOUND, 'API call not found.'));
	});

	// Include the post-API router
	this.mainRouter.use(this.postAPIRouter);

	// Return errors
	this.mainRouter.use(function(error, res, res, next) {
		error = transformAPIError(error, options);
		var httpCode = (ZSError.getErrorCodeData(error.code) || {}).http || 500;
		res.send(httpCode, jsonStringify(error));
	});

}

/* Arguments are: name (dot-separated), method (or array of methods),
			and handlers (function(req, res, next)) */
RestRouter.prototype.registerAPICall = function() {
	var self = this;
	var params = parseRegisterArgs.parseArgs(arguments);

	var regArgs = [
		params.name,
		function(req, res, next) {
			req.apiName = params.name;
			next();
		}
	].concat(params.middleware);

	var methods = [ 'get', 'post', 'put', 'delete' ];
	methods.forEach(function(method) {
		self.apiCallRouter[method].apply(self.apiCallRouter, regArgs);
	});
};


module.exports = RestRouter;
