const { deepCopy, ObjectMask, deletePath } = require('objtools');
const { Schema, createSchema } = require('common-schema');

/**
 * This class contains code for creating a route that returns information about
 * available API calls.
 *
 * @class APIInfo
 * @constructor
 * @param {Object} [options]
 *   @param {Object} [options.extraModels] - Additional models to include in the response.  This is
 *     a map from model name to schema.
 */
class APIInfo {

	constructor(options = {}) {
		this.options = options;
		// List of fields on the method info object to return in the result
		this.methodInfoMask = new ObjectMask({
			method: true,
			description: true
		});
		// List of fields on subschemas to return
		this.subschemaMask = new ObjectMask({
			type: true,
			properties: true,
			elements: true,
			description: true,
			required: true,
			values: true,
			alternatives: true,
			minLength: true,
			maxLength: true,
			min: true,
			max: true,
			match: true,
			enum: true,
			modelName: true
		});
	}

	/**
	 * Returns the middleware function to use for returning API information.
	 *
	 * @method getRoute
	 * @param {VersionRouter} versionRouter - The VersionRouter containing the API methods
	 * @return {Function} - An API route middleware function - function(ctx)
	 */
	getRoute(versionRouter) {
		return (ctx) => {
			let methodsResponse = {};
			let modelsResponse = {};
			let methods = versionRouter.getMethods();
			let models = {};

			const processSchema = (schema) => {
				if (!Schema.isSchema(schema)) schema = createSchema(schema);
				let schemaData = deepCopy(schema.getData());
				let filteredSchema = new Schema(schemaData, schema._schemaFactory);
				let subschemaMask = this.subschemaMask;
				filteredSchema.traverseSchema({
					onSubschema(subschema) {
						if (subschema.modelName && subschema.documentSchema) {
							models[subschema.modelName] = subschema.documentSchema;
						}
						let deleteFields = subschemaMask.getMaskedOutFields(subschema);
						for (let field of deleteFields) {
							deletePath(subschema, field);
						}
						if (subschema.properties) delete subschema.properties._id;
					}
				});
				return filteredSchema.getData();
			};

			for (let methodName in methods) {
				let methodInfo = methods[methodName];
				let methodResponse = this.methodInfoMask.filterObject(methodInfo);
				if (methodInfo.schema) {
					methodResponse.schema = processSchema(methodInfo.schema);
				}
				if (methodInfo.responseSchema) {
					methodResponse.responseSchema = processSchema(methodInfo.responseSchema);
				}
				methodsResponse[methodName] = methodResponse;
			}

			for (let modelName in models) {
				modelsResponse[modelName] = processSchema(models[modelName]);
			}

			if (this.options.extraModels) {
				for (let modelName in this.options.extraModels) {
					modelsResponse[modelName] = processSchema(this.options.extraModels[modelName]);
				}
			}

			let response = {
				methods: methodsResponse
			};
			if (Object.keys(modelsResponse).length) {
				response.models = modelsResponse;
			}

			return response;
		};
	}
}

module.exports = APIInfo;

