var express = require('express');
var ZSError = require('zs-error');
var transformError = require('./error-transform');
var parseRegisterArgs = require('./parse-register-args');

function randJSONRPCId() {
	return '' + Math.floor(Math.random() * 1000000);
}

function JSONRPCRouter(options) {
	var self = this;
	if(!options) options = {};
	this.options = options;

	// Map from API call name to { options: ..., middleware: [...] }
	this.apiCalls = {};

	// Create an express router to catch RPC requests
	this.apiCallRouter = express.Router({
		caseSensitive: true,
		strict: false
	});

	// Create an express router to use for postprocessing API errors
	this.postAPIRouter = express.Router({});

	// Router that wraps the sub-routers
	this.mainRouter = express.Router({});

	// Register the RPC routes
	this.apiCallRouter.get('/json', function(req, res, next) {
		if(req.query.jsonrpc) {
			try {
				self.handleRPCRequest(req, res, next, JSON.parse(req.query.jsonrpc));
			} catch (ex) {
				next(new ZSError(ZSError.BAD_REQUEST, 'Invalid RPC request', ex));
			}
		} else {
			try {
				self.handleRPCRequest(req, res, next, {
					method: req.query.method,
					id: req.query.id || randJSONRPCId(),
					params: JSON.parse(req.query.params || '{}')
				});
			} catch (ex) {
				next(new ZSError(ZSError.BAD_REQUEST, 'Invalid RPC request', ex));
			}
		}
	});

	this.apiCallRouter.post('/json', function(req, res, next) {
		self.handleRPCRequest(req, res, next, req.body);
	});

	this.apiCallRouter.all('*', function(req, res, next) {
		next(new ZSError(ZSError.BAD_REQUEST, 'Invalid RPC endpoint'));
	});

	// Construct the main router
	this.mainRouter.use(this.apiCallRouter);
	this.mainRouter.use(this.postAPIRouter);

	// Handle errors
	/* jshint unused: false */
	this.mainRouter.use(function(error, req, res, next) {
		error = transformError(error, options);

		if(req.isJSONRPCNotification) {
			// There is no return value for JSON-RPC notifications
			res.send(200);
			return;
		}

		res.send(self.jsonStringify({
			jsonrpc: '2.0',
			result: null,
			error: error,
			id: req.jsonRPCId || null
		}));
	});
	/* jshint unused: true */

}

JSONRPCRouter.prototype.jsonStringify = function(val) {
	if(this.options.prettyJSON) {
		return JSON.stringify(val, null, '\t');
	} else {
		return JSON.stringify(val);
	}
};

JSONRPCRouter.prototype.registerAPICall = function() {
	var self = this;
	var params = parseRegisterArgs.parseArgs(arguments);
	var name = params.bareName;
	if(self.apiCalls[name]) throw ('Api call already exists: ' + name);
	self.apiCalls[name] = {
		options: params.options,
		middleware: params.middleware
	};
};

JSONRPCRouter.prototype.handleRPCRequest = function(req, res, next, data) {
	var rpcRouter = this;
	if(!data) return next(new ZSError(ZSError.BAD_REQUEST));

	var apiCallName = data.method;
	var params = data.params;
	var reqId = (data.id === undefined) ? randJSONRPCId() : data.id;

	res.set('Content-type', 'application/json');

	if(!apiCallName) return next(new ZSError(ZSError.BAD_REQUEST, 'JSON RPC requires a method field'));
	if(!params) params = {};

	var apiCall = this.apiCalls[apiCallName];
	if(!apiCall) {
		return next(new ZSError(ZSError.NOT_FOUND, 'RPC method ' + apiCallName + ' not found'));
	}

	req.apiMethod = apiCallName;

	// Method to get parameters
	req.origParam = req.param;
	req.param = function(name) {
		return params[name];
	};

	req.getAllParams = function() {
		return params;
	};

	// Method to send result
	res.result = function(result) {
		if(reqId === null) {	// Notification without result, as per JSON-RPC specification
			res.send(200);
			return;
		}
		if(result === undefined) result = { success: true };
		var jsonrpcResult = {
			jsonrpc: '2.0',
			result: result,
			error: null,
			id: reqId
		};
		res.send(rpcRouter.jsonStringify(jsonrpcResult));
	};

	// Run middleware
	function runHandlerIdx(handlerIdx) {
		if(handlerIdx >= apiCall.middleware.length) return;
		apiCall.middleware[handlerIdx](req, res, function(error) {
			if(error) {
				next(error);
			} else {
				runHandlerIdx(handlerIdx + 1);
			}
		});
	}
	runHandlerIdx(0);

};

module.exports = JSONRPCRouter;

