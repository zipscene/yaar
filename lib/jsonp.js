/**
 * Transparent JSONP middleware.
 * Including this middleware will look for a callback query string parameter called either 'jsonp' or 'callback', for the jsonp callback.
 * It will overwrite the res.send() method to write out a javascript result instead of the plain result.
 * The query string parameters 'method' and 'body' may also be supplied, containing the HTTP method to emulate, and the JSON body for POST/PUT methods, respectively.
 */

module.exports = function(req, res, next) {
	if(req.method === 'GET' && req.query && (req.query.jsonp || req.query.callback)) {
		if(req.query.method) {
			req.originalMethod = req.method;
			req.method = req.query.method.toUpperCase();
			delete req.query.method;
		}
		if(req.query.body) {
			try {
				req.body = JSON.parse(req.query.body);
			} catch (ex) {
				return next(ex);
			}
			delete req.query.body;
			if(req.url) req.url = req.url.replace(/([&?]body=)[^&]*/, '$1<JSONP_BODY>');
			if(req.originalUrl) req.originalUrl = req.originalUrl.replace(/([&?]body=)[^&]*/, '$1<JSONP_BODY>');
		}
		var callback = req.query.jsonp || req.query.callback;
		res.originalSend = res.send;
		res.send = function() {
			var body = arguments[0], statusCode = 200;
			if(arguments.length == 2) {
				if(typeof arguments[0] != 'number' && typeof arguments[1] == 'number') {
					statusCode = arguments[1];
				} else {
					body = arguments[1];
					statusCode = arguments[0];
				}
			}
			res.set('Content-type', 'text/javascript');
			if(typeof body == 'string' && body[0] == '{') {
				body = JSON.parse(body);
			}
			res.originalSend(callback + '(' + JSON.stringify({
				statusCode: statusCode,
				response: body
			}) + ');\n');
		};
	}
	next();
};
