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

	// Wrap each middleware in a try/catch to prevent express from catching the errors
	params.middleware.forEach(function(func, idx) {
		params.middleware[idx] = function(req, res, next) {
			try {
				return func.apply(this, Array.prototype.slice.call(arguments, 0));
			} catch (ex) {
				process.emit('uncaughtException', ex);
				next(new ZSError(ZSError.INTERNAL_ERROR, 'An internal uncaught exception occurred'));
			}
		};
	});

	this.restRouter.registerAPICall(params);
	if(!params.options.norpc) {
		this.jsonrpcRouter.registerAPICall(params);
	}
};

APIRouter.prototype.register = APIRouter.prototype.registerAPICall;

APIRouter.prototype.collection = function(baseName, itemName, itemIdName, groupKeyNames) {
	return new APIRouterCollection(this, baseName, itemName, itemIdName, groupKeyNames);
};


function APIRouterCollection(apiRouter, baseName, itemName, itemIdName, itemGroupKeyNames) {
	this.apiRouter = apiRouter;
	this.baseName = baseName;
	this.itemName = itemName || 'item';
	this.itemIdName = itemIdName || 'id';
	this.groupKeys = itemGroupKeyNames || [];
	this.baseRoute = baseName;
	if(itemGroupKeyNames && itemGroupKeyNames.length) {
		this.baseRoute += '/:' + itemGroupKeyNames.join('/:');
	}
}

APIRouterCollection.prototype._register = function(name, options, args, requiredParams, extraMiddleware) {
	if(extraMiddleware && !Array.isArray(extraMiddleware)) extraMiddleware = [extraMiddleware];
	this.apiRouter.registerAPICall.apply(this.apiRouter, [name, options].concat(extraMiddleware || []).concat([function(req, res, next) {
		// Check for required parameters
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

// Maps various parameters to other parameters (body/item, id, etc)
APIRouterCollection.prototype._paramMapper = function(remapItem, remapBody, remapId) {
	var self = this;
	return function(req, res, next) {
		// If 'id' is supplied, but not the itemId, set 'id', and vice-versa
		if(remapId) {
			if(self.itemIdName != 'id') {
				if(req.param(self.itemIdName) && !req.param('id')) {
					req.setParam('id', req.param(self.itemIdName));
				} else if(req.param('id') && !req.param(self.itemIdName)) {
					req.setParam(self.itemIdName);
				}
			}
		}
		// If a body is given, remap it to both 'item' and the item name, then prevent it from being used as parameters
		if(remapBody) {
			if(req.body) {
				if(req._setUseParamsFromBody) req._setUseParamsFromBody(false);
				req.setParam('item', req.body);
				if(self.itemName != 'item') {
					req.setParam(self.itemName, req.body);
				}
			}
		}
		// If a named item parameter is given, map it to 'item' and vice-versa
		if(remapItem) {
			if(self.itemName != 'item') {
				if(req.param(self.itemName) && !req.param('item')) {
					req.setParam('item', req.param(self.itemName));
				} else if(req.param('item') && !req.param(self.itemName)) {
					req.setParam(self.itemName, req.param('item'));
				}
			}
		}
		next();
	};
};

APIRouterCollection.prototype.get = function() {
	// Standard REST call
	this._register(this.baseRoute + '.:' + this.itemIdName, { get: true, norpc: true }, arguments, [this.itemIdName], this._paramMapper(false, false, true));
	// Collection-style REST call and RPC call
	this._register('collection.' + this.baseRoute + '.get', { get: true, post: true }, arguments, [this.itemIdName], this._paramMapper(false, false, true));
	// Standard RPC call
	this._register(this.baseRoute + '.:' + this.itemIdName + '.get', {}, arguments, [this.itemIdName], this._paramMapper(false, false, true));
};

APIRouterCollection.prototype.replace = function() {
	// Standard REST call
	this._register(this.baseRoute + '.:' + this.itemIdName, { put: true, norpc: true }, arguments, [this.itemIdName, this.itemName], this._paramMapper(true, true, true));
	// PUT to base collection with item ID in the body
	this._register(this.baseRoute, { put: true, norpc: true }, arguments, [this.itemName], this._paramMapper(true, true, true));
	// Collection-style call
	this._register('collection.' + this.baseRoute + '.replace', { post: true }, arguments, [ this.itemIdName, this.itemName ], this._paramMapper(true, false, true));
	// Collection-style call with item ID in query
	this._register('collection.' + this.baseRoute + '.replace.:' + this.itemIdName, { post: true, norpc: true }, arguments, [ this.itemIdName, this.itemName ], this._paramMapper(true, false, true));
	// RPC call
	this._register(this.baseRoute + '.:' + this.itemIdName + '.replace', {}, arguments, [ this.itemIdName, this.itemName ], this._paramMapper(true, false, true));
};

APIRouterCollection.prototype.put = APIRouterCollection.prototype.replace;

APIRouterCollection.prototype.update = function() {
	// There's no REST verb for update ... only register collection-style calls and RPC call
	// Collection-style call
	this._register('collection.' + this.baseRoute + '.update', { post: true }, arguments, [ this.itemIdName, 'updates' ], this._paramMapper(false, false, true));
	// Collection-style call with item ID in query
	this._register('collection.' + this.baseRoute + '.update.:' + this.itemIdName, { post: true, norpc: true }, arguments, [ this.itemIdName, 'updates' ], this._paramMapper(false, false, true));
	// RPC call
	this._register(this.baseRoute + '.:' + this.itemIdName + '.update', {}, arguments, [ this.itemIdName, 'updates' ], this._paramMapper(false, false, true));
};

APIRouterCollection.prototype.multiGet = function() {
	// There's no REST verb for multiGet ... only register collection-style call and RPC call
	// Collection-style call
	this._register('collection.' + this.baseRoute + '.multiget', { post: true }, arguments, [ this.itemIdName + 's' ]);
	// RPC call
	this._register(this.baseRoute + '.multiget', {}, arguments, [ this.itemIdName + 's' ]);
};

APIRouterCollection.prototype.delete = function() {
	// Standard REST call
	this._register(this.baseRoute + '.:' + this.itemIdName, { delete: true, norpc: true }, arguments, [this.itemIdName], this._paramMapper(false, false, true));
	// Collection-style REST call and RPC call
	this._register('collection.' + this.baseRoute + '.delete', { delete: true, post: true }, arguments, [this.itemIdName], this._paramMapper(false, false, true));
	// Standard RPC call
	this._register(this.baseRoute + '.:' + this.itemIdName + '.delete', {}, arguments, [this.itemIdName], this._paramMapper(false, false, true));
};

APIRouterCollection.prototype.create = function() {
	// Standard REST call (POST to root of collection)
	this._register(this.baseRoute, { post: true, norpc: true }, arguments, [ this.itemName ], this._paramMapper(true, true, true));
	// Collection-style call
	this._register('collection.' + this.baseRoute + '.create', { post: true }, arguments, [ this.itemName ], this._paramMapper(true, false, true));
	// RPC call
	this._register(this.baseRoute + '.:' + this.itemIdName + '.create', {}, arguments, [ this.itemName ], this._paramMapper(true, false, true));
};

APIRouterCollection.prototype.list = function() {
	// Register REST calls on the collection base route and the base route corresponding to each of the group keys
	// These correspond to querying with or without including the various group keys
	for(var i = 0; i <= this.groupKeys.length; i++) {
		var route = this.baseName;
		if(i > 0) route += '/:' + this.groupKeys.slice(0, i).join('/:');
		this._register(route, { get: true, norpc: true }, arguments);
		this._register('collection.' + route + '.list', { get: true, post: true, norpc: true }, arguments);
	}
	// Collection-style RPC call
	this._register('collection.' + this.baseRoute + '.list', {}, arguments);
	// Standard RPC call
	this._register(this.baseRoute + '.list', {}, arguments);
};

APIRouterCollection.prototype.itemAction = function(actionName/*, ...*/) {
	var args = Array.prototype.slice.call(arguments, 1);
	var options = { post: true };
	if(typeof args[0] == 'object') {
		options = args[0];
		args = args.slice(1);
	}
	// Collection-style call
	this._register('collection.' + this.baseRoute + '.' + actionName, options, args, [ this.itemIdName ], this._paramMapper(false, false, true));
	// Collection-style call with item ID in query string
	this._register('collection.' + this.baseRoute + '.' + actionName + '.:' + this.itemIdName, options, args, [ this.itemIdName ], this._paramMapper(false, false, true));
	// RPC call
	this._register(this.baseRoute + '.:' + this.itemIdName + '.' + actionName, {}, args, [ this.itemIdName ], this._paramMapper(false, false, true));
};

APIRouterCollection.prototype.collectionAction = function(actionName/*, ...*/) {
	var args = Array.prototype.slice.call(arguments, 1);
	var options = { post: true };
	if(typeof args[0] == 'object') {
		options = args[0];
		args = args.slice(1);
	}
	// Collection-style call
	this._register('collection.' + this.baseRoute + '.' + actionName, options, args);
	// Collection-style call with item ID in query string
	this._register('collection.' + this.baseRoute + '.' + actionName, options, args);
	// RPC call
	this._register(this.baseRoute + '.' + actionName, {}, args);
};


module.exports = APIRouter;
