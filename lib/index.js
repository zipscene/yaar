var cors = require('cors');
var bodyParser = require('body-parser');
var express = require('express');
var ZSError = require('zs-error');
var RESTRouter = require('./rest-router');
var JSONRPCRouter = require('./jsonrpc-router');
var jsonp = require('./jsonp');
var parseRegisterArgs = require('./parse-register-args');


// Options can include:
// - forceSSL
// - prettyJSON
// - returnStackTrace
// - allowJSONP
// - requestSizeLimit
function APIRouter(options) {
	if(!options) options = {};

	// Instantiate the main router used for API calls
	this.router = express.Router({ caseSensitive: true, strict: false });

	// Register middleware to force SSL
	if(options.forceSSL) {
		this.router.use(function(req, res, next) {
			if(req.secure || req.url === '/') {
				next();
			} else {
				next(new ZSError(ZSError.BAD_REQUEST, 'HTTPS is required for this request.'));
			}
		});
	}

	// Allow CORS
	this.router.use(cors({
		methods: [ 'GET', 'POST', 'PUT', 'DELETE' ],
		headers: [ 'Content-type', 'Authorization' ]
	}));

	// Allow JSONP
	if(options.allowJSONP) {
		this.router.use(jsonp);
	}

	// Body parsers
	this.router.use(bodyParser.json({limit: options.requestSizeLimit || '50mb'}));
	this.router.use(bodyParser.urlencoded({limit: options.requestSizeLimit || '50mb'}));

	// Include RPC router
	this.jsonrpcRouter = new JSONRPCRouter(options);
	this.router.use('/rpc', this.jsonrpcRouter.mainRouter);

	// Include REST router
	this.restRouter = new RESTRouter(options);
	this.router.use('/api', this.restRouter.mainRouter);

}

// Call to register an API call
APIRouter.prototype.registerAPICall = function() {
	var params = parseRegisterArgs.parseArgs(arguments);
	if(!params.options) params.options = {};
	this.restRouter.registerAPICall(params);
	if(!params.options.norpc) {
		this.jsonrpcRouter.registerAPICall(params);
	}
};

APIRouter.prototype.register = APIRouter.prototype.registerAPICall;

APIRouter.prototype.collection = function(baseName, itemName, itemIdName) {
	return new APIRouterCollection(this, baseName, itemName, itemIdName);
};


function APIRouterCollection(apiRouter, baseName, itemName, itemIdName) {
	this.apiRouter = apiRouter;
	this.baseName = baseName;
	this.itemName = itemName || 'item';
	this.itemIdName = itemIdName || 'id';
}

APIRouterCollection.prototype._register = function(name, options, args, requiredParams, extraMiddleware) {
	this.apiRouter.registerAPICall.apply(this.apiRouter, [name, options].concat(extraMiddleware || []).concat([function(req, res, next) {
		if(requiredParams) {
			for(var i = 0; i < requiredParams.length; ++i) {
				if(req.param(requiredParams[i]) === undefined || req.param(requiredParams[i]) === null) {
					return next(new ZSError(ZSError.BAD_REQUEST, 'Parameter ' + requiredParams[i] + ' is required.'));
				}
			}
		}
		next();
	}]).concat(Array.prototype.slice.call(args, 0)));
};

APIRouterCollection.prototype.get = function() {
	// Standard REST call
	this._register(this.baseName + '.:' + this.itemIdName, { get: true, norpc: true }, arguments, [this.itemIdName]);
	// Collection-style REST call and RPC call
	this._register('collection.' + this.baseName + '.get', { get: true, post: true }, arguments, [this.itemIdName]);
	// Standard RPC call
	this._register(this.baseName + '.:' + this.itemIdName + '.get', {}, arguments, [this.itemIdName]);
};

APIRouterCollection.prototype.replace = function() {
	var self = this;
	// Standard REST call
	this._register(this.baseName + '.:' + this.itemIdName, { put: true, norpc: true }, arguments, null, [function(req, res, next) {
		var item = req.body;
		req.body = {};
		req.body[self.itemName] = item;
		next();
	}]);
	// PUT to base collection with item ID in the body
	this._register(this.baseName, { put: true, norpc: true }, arguments, null, [function(req, res, next) {
		var item = req.body;
		req.body = {};
		req.body[self.itemName] = item;
		req.query[self.itemIdName] = '';
		next();
	}]);
	// Collection-style call
	this._register('collection.' + this.baseName + '.replace', { post: true }, arguments, [ self.itemIdName, self.itemName ]);
	// Collection-style call with item ID in query
	this._register('collection.' + this.baseName + '.replace.:' + this.itemIdName, { post: true, norpc: true }, arguments, [ self.itemIdName, self.itemName ]);
	// RPC call
	this._register(this.baseName + '.:' + this.itemIdName + '.replace', {}, arguments, [ self.itemIdName, self.itemName ]);
};

APIRouterCollection.prototype.put = APIRouterCollection.prototype.replace;

APIRouterCollection.prototype.update = function() {
	// There's no REST verb for update ... only register collection-style calls and RPC call
	// Collection-style call
	this._register('collection.' + this.baseName + '.update', { post: true }, arguments, [ this.itemIdName, 'updates' ]);
	// Collection-style call with item ID in query
	this._register('collection.' + this.baseName + '.update.:' + this.itemIdName, { post: true, norpc: true }, arguments, [ this.itemIdName, 'updates' ]);
	// RPC call
	this._register(this.baseName + '.:' + this.itemIdName + '.update', {}, arguments, [ this.itemIdName, 'updates' ]);
};

APIRouterCollection.prototype.multiGet = function() {
	// There's no REST verb for multiGet ... only register collection-style call and RPC call
	// Collection-style call
	this._register('collection.' + this.baseName + '.multiget', { post: true }, arguments, [ this.itemIdName + 's' ]);
	// RPC call
	this._register(this.baseName + '.multiget', {}, arguments, [ this.itemIdName + 's' ]);
};

APIRouterCollection.prototype.delete = function() {
	// Standard REST call
	this._register(this.baseName + '.:' + this.itemIdName, { delete: true, norpc: true }, arguments, [this.itemIdName]);
	// Collection-style REST call and RPC call
	this._register('collection.' + this.baseName + '.delete', { delete: true, post: true }, arguments, [this.itemIdName]);
	// Standard RPC call
	this._register(this.baseName + '.:' + this.itemIdName + '.delete', {}, arguments, [this.itemIdName]);
};

APIRouterCollection.prototype.create = function() {
	var self = this;
	// Standard REST call (POST to root of collection)
	this._register(this.baseName, { post: true, norpc: true }, arguments, [ this.itemName ], [function(req, res, next) {
		var item = req.body;
		req.body = {};
		req.body[self.itemName] = item;
		next();
	}]);
	// Collection-style call
	this._register('collection.' + this.baseName + '.create', { post: true }, arguments, [ this.itemName ], [function(req, res, next) {
		if(req.param(self.itemIdName) && req.param(self.itemName)) {
			req.param(self.itemName)[self.itemIdName] = req.param(self.itemIdName);
		}
		next();
	}]);
	// RPC call
	this._register(this.baseName + '.:' + this.itemIdName + '.create', {}, arguments, [ this.itemName ], [function(req, res, next) {
		if(req.param(self.itemIdName) && req.param(self.itemName)) {
			req.param(self.itemName)[self.itemIdName] = req.param(self.itemIdName);
		}
		next();
	}]);
};

APIRouterCollection.prototype.list = function() {
	// Standard REST call (GET on collection base)
	this._register(this.baseName, { get: true, norpc: true }, arguments);
	// Collection-style REST call and RPC call
	this._register('collection.' + this.baseName + '.list', { get: true, post: true }, arguments);
	// Standard RPC call
	this._register(this.baseName + '.list', {}, arguments);
};

APIRouterCollection.prototype.itemAction = function(actionName/*, ...*/) {
	var args = Array.prototype.slice.call(arguments, 1);
	var options = { post: true };
	if(typeof args[0] == 'object') {
		options = args[0];
		args = args.slice(1);
	}
	// Collection-style call
	this._register('collection.' + this.baseName + '.' + actionName, options, args, [ this.itemIdName ]);
	// Collection-style call with item ID in query string
	this._register('collection.' + this.baseName + '.' + actionName + '.:' + this.itemIdName, options, args, [ this.itemIdName ]);
	// RPC call
	this._register(this.baseName + '.:' + this.itemIdName + '.' + actionName, {}, args, [ this.itemIdName ]);
};

APIRouterCollection.prototype.collectionAction = function(actionName/*, ...*/) {
	var args = Array.prototype.slice.call(arguments, 1);
	var options = { post: true };
	if(typeof args[0] == 'object') {
		options = args[0];
		args = args.slice(1);
	}
	// Collection-style call
	this._register('collection.' + this.baseName + '.' + actionName, options, args);
	// Collection-style call with item ID in query string
	this._register('collection.' + this.baseName + '.' + actionName, options, args);
	// RPC call
	this._register(this.baseName + '.' + actionName, {}, args);
};


module.exports = APIRouter;
