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


function APIRouterCollection(apiRouter, baseName, itemName, itemIdName) {
	this.apiRouter = apiRouter;
	this.baseName = baseName;
	this.itemName = itemName || 'item';
	this.itemIdName = itemIdName || 'id';
}

APIRouterCollection.prototype._register = function(name, options, args, requiredParams, extraMiddleware) {
	this.apiRouter.registerAPICall.apply(this.apiRouter, [name, options].concat([function(req, res, next) {
		if(requiredParams) {
			for(var i = 0; i < requiredParams.length; ++i) {
				if(req.param(requiredParams[i]) === undefined || req.param(requiredParams[i]) === null) {
					return next(new ZSError(ZSError.BAD_REQUEST, 'Parameter ' + requiredParams[i] + ' is required.'))''
				}
			}
		}
		next();
	}]).concat(extraMiddleware || []).concat(Array.prototype.slice.call(args, 0)));
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
	var self = this
	// Standard REST call
	this._register(this.baseName + '.:' + this.itemIdName, { put: true, norpc: true }, arguments, [this.itemIdName, this.itemName], [function(req, res, next) {
		var item = req.body;
		req.body = {};
		req.body[self.itemName] = item;
		next();
	}]);

};

APIRouterCollection.prototype.put = APIRouterCollection.prototype.replace;

APIRouterCollection.prototype.update = function() {

};

APIRouterCollection.prototype.multiGet = function() {

};

APIRouterCollection.prototype.delete = function() {

};

APIRouterCollection.prototype.create = function() {

};

APIRouterCollection.prototype.list = function() {

};

APIRouterCollection.prototype.itemAction = function(actionName/*, ...*/) {

};

APIRouterCollection.prototype.collectionAction = function(actionName/*, ...*/) {

};

