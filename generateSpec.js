module.exports = function (grunt) {
	var esprima = require('esprima'),
		_ = require('underscore');

	var serviceMockString = '\'Tests/mock/services/<%SERVICENAME%>\',\n',

		provideWrapper = '' +
			tabString(3) + 'beforeEach(module(function ($provide) {\n' +
			'<%PROVIDERS%>' +
			tabString(3) + '}));\n',

		providerTemplate = '' +
			tabString(4) + '$provide.provider(\'<%SERVICENAME%>\', function () {\n' +
			tabString(5) + 'this.$get = <%SERVICEMOCK%>;\n' +
			tabString(4) + '});\n',

		httpAfterEach = '' +
			tabString(3) + 'afterEach(function () {\n' +
			tabString(4) + 'httpBackend.verifyNoOutstandingExpectation();\n' +
			tabString(4) + 'httpBackend.verifyNoOutstandingRequest();\n' +
			tabString(3) + '});\n',

		cleanup = '' +
			tabString(3) + 'describe(\'Cleanup\', function () {\n' +
			tabString(4) + 'it(\'should clean up event listener callbacks\', function () {\n' +
			tabString(5) + '<%SCOPETODESTROY%>.$destroy();\n' +
			'<%SPYOFFEXPECTS%>' +
			tabString(4) + '});\n' +
			tabString(3) + '});';

	function tabString(len) {
		return new Array(len + 1).join('	');
	}

	grunt.registerTask('generateSpec', 'PROTOTYPE: Creates generic spec template (in build.log output) for any file found matching the passed in file name', function (fileName) {
		grunt.task.run('usethe:force:luke');
		grunt.file.expand('../app/**/*(*' + fileName + '|*' + fileName + '*.js)').forEach(function (file) {
			var template = grunt.file.read('./templates/spec.txt');
			var prima = esprima.parse(grunt.file.read(file)),
				specType,
				specName,
				injections = [],
				angularInjections = [],
				vars = [],
				restricts,
				scope;

			_.each(prima, function (value) {
				goDown(value);
				function goDown(it) {
					_.each(it, function (v, k) {
						if (typeof v === 'object') {
							goDown(v);
						}
						else {

							if (k === 'type' && v === 'Property') {
								if (it.key.name === 'restrict') {
									restricts = it.value.value;
								}
							}

							if (k === 'type' && v === 'Property') {
								if (it.key.name === 'scope') {
									scope = it.value.properties;
								}
							}

							// current type is an ExpressionStatement
							if (k === 'type' && v === 'ExpressionStatement') {
								// if parent expression type is a CallExpression
								if (it.expression.type === 'CallExpression') {
									// if it has a callee
									if (it.expression.callee) {
										// and the callee has an object
										if (it.expression.callee.object) {
											// and that object name is 'app'
											if (it.expression.callee.object.name === 'app') {
												// the app.property name is our type. directive, controller , etc (app.Whatever)
												specType = it.expression.callee.property.name;
												// this is the actual name
												specName = _.findWhere(it.expression.arguments, { type: 'Literal' }).value;

												var f = _.findWhere(it.expression.arguments, { type: 'ArrayExpression' });
												// get value of all non '$' angular ish injections
												injections = _.pluck(_.filter(f.elements, function (l) {
													return l.type === 'Literal' && l.value.charAt(0) !== '$';
												}), 'value');
												// get value of all '$' angular ish injections
												angularInjections = _.pluck(_.filter(f.elements, function (l) {
													return l.type === 'Literal' && l.value.charAt(0) === '$';
												}), 'value');
												return;
											}
										}
									}
								}
							}
						}
					});
				}

				if (typeof specType !== 'undefined') {
					var pathToSource = file.replace('../app/', '').replace('.js', '');
					var extensionLessFileName = file.substring(file.lastIndexOf('/') + 1).replace('.js', '');
					var camelSpecName = specName.charAt(0).toLowerCase() + specName.slice(1);

					var t = template.replace('<%DESCRIBEWHAT%>', specName),
						injDefineStr = '';

					injectionsSetup();

					switch (specType) {
						case 'directive':
							directiveSetup();
							break;
						case 'controller':
							controllerSetUp();
							break;
						case 'service':
						case 'factory':
							serviceSetup();
							break;
						case 'filter':
						case 'provider':
						default:
							t = t.replace('<%CREATECOMPILE%>', '\n');
					}

					setupVars();

					console.log('');
					console.log(t);
					console.log('For targeted testing:	grunt debugCustom:' + extensionLessFileName);
				}

				function setupVars() {
					var varStr = '';
					switch (vars.length) {
						case 1:
							varStr += tabString(3) + 'var ' + vars[0] + ';\n';
							break;
						default:
							_.each(vars, function (v, idx) {
								// first one adds var, last one adds ;
								varStr += idx == 0 ? tabString(3) + 'var ' + v + ',\n' :
											  tabString(4) + v + (idx + 1 === vars.length ? ';' : ',') + '\n';
							});
							break;
					}
					t = t.replace('<%VARS%>', varStr);
				}

				function injectionsSetup() {
					var beforeEachInjections = '',
						injStr = '',
						providerStr = '';
					_.each(injections, function (injection) {

						// special case, we use the real hardwareBagManipulator since it doesnt have any external dependencies
						if (injection === 'hardwareBagManipulator') {
							return;
						}

						var injectionMock = injection + 'Mock';
						// environment is not a service and is found in mocks/
						if (injection === 'environment') {
							injDefineStr += tabString(1) + serviceMockString.replace('services/<%SERVICENAME%>', injectionMock);
						}
						else {
							beforeEachInjections += tabString(4) + injection + ' = $injector.get(\'' + injection + '\');\n';
							providerStr += providerTemplate.replace('<%SERVICENAME%>', injection).replace('<%SERVICEMOCK%>', injectionMock);
							injDefineStr += tabString(1) + serviceMockString.replace('<%SERVICENAME%>', injectionMock);
							vars.push(injection);
						}
						injStr += ', ' + injectionMock;
					});

					// custom setup for $uibModal usage
					if (_.contains(angularInjections, '$uibModal')) {
						vars.push('uibModal');
						beforeEachInjections += tabString(4) + 'uibModal = $injector.get(\'$uibModal\');\n';
						injStr += ', uibModalMock';
						injDefineStr += tabString(1) + serviceMockString.replace('<%SERVICENAME%>', 'uibModalMock');
						providerStr += providerTemplate.replace('<%SERVICENAME%>', '$uibModal').replace('<%SERVICEMOCK%>', 'uibModalMock');
					}
					// add the path to source file last
					injDefineStr += tabString(1) + '\'' + pathToSource + '\'\n';

					t = t.replace('<%INJECTIONS%>', injDefineStr);
					t = t.replace('<%MOCKS%>', injStr ? injStr.slice(1) : '');
					t = t.replace('<%PROVIDERS%>', providerStr ? provideWrapper.replace('<%PROVIDERS%>', providerStr) : '');

					if (_.contains(angularInjections, '$http')) {
						vars.push('httpBackend');
						beforeEachInjections += tabString(4) + 'httpBackend = $injector.get(\'$httpBackend\');\n';
						t = t.replace('<%HTTPAFTEREACH%>', httpAfterEach);
					}
					else {
						t = t.replace('<%HTTPAFTEREACH%>', '');
					}

					if (specType === 'controller') {
						beforeEachInjections += tabString(4) + 'controller = $injector.get(\'$controller\');\n';
					}

					if (specType === 'directive') {
						beforeEachInjections += tabString(4) + 'compile = $injector.get(\'$compile\');\n';
					}

					if (specType === 'service' || specType === 'factory') {
						vars.push(camelSpecName);
						beforeEachInjections += tabString(4) + camelSpecName + ' = $injector.get(\'' + specName + '\');\n';
					}

					t = t.replace('<%BEINJECTIONS%>', beforeEachInjections);
				}

				function matchAll(str, regex) {
					var res = [],
						m;
					if (regex.global) {
						while (m = regex.exec(str)) {
							res.push(m[1]);
						}
					}
					else {
						if (m = regex.exec(str)) {
							res.push(m[1]);
						}
					}
					return res;
				}

				function injectDashes(str) {
					return str.replace(/([a-z](?=[A-Z]))/g, '$1-').toLowerCase();
				}

				function cleanupSetup(scopeToDestroy) {
					// check if there is a explicit call to $destroy(
					if (grunt.file.read(file).indexOf('scope.$on(\'$destroy\'') > 0) {
						var cu = cleanup;
						var fileString = grunt.file.read(file);

						var beSpies = '',
							spyOffExpects = '',
							initExpects = '';

						_.each(injections, function (injection) {
							var re = new RegExp('(' + injection + '\\.(.*)\\.on)', 'g');
							var matches = matchAll(fileString, re);
							_.each(matches, function (match) {
								beSpies += tabString(4) + 'spyOn(' + match.replace('.on', ", 'on'") + ').and.callThrough();\n';
								beSpies += tabString(4) + 'spyOn(' + match.replace('.on', ", 'off'") + ').and.callThrough();\n';
								initExpects += tabString(5) + 'expect(' + match + ').toHaveBeenCalled();\n';
								spyOffExpects += tabString(5) + 'expect(' + match.replace('.on', '.off') + ').toHaveBeenCalled();\n';
							});
						});

						if (initExpects) {
							t = t.replace('<%INITEXPECTS%>', initExpects);
						}
						else {
							t = t.replace('<%INITEXPECTS%>', '');
						}
						if (beSpies) {
							t = t.replace('<%BESPIES%>', beSpies);
						}
						else {
							t = t.replace('<%BESPIES%>', '');
						}
						if (spyOffExpects) {
							cu = cu.replace('<%SPYOFFEXPECTS%>', spyOffExpects);
						}
						else {
							cu = cu.replace('<%SPYOFFEXPECTS%>', '');
						}

						t = t.replace('<%CLEANUP%>', cu.replace('<%SCOPETODESTROY%>', scopeToDestroy));
					}
					else {
						t = t.replace('<%CLEANUP%>', '');
						t = t.replace('<%BESPIES%>', '');
						t = t.replace('<%INITEXPECTS%>', '');
					}
				}

				function directiveSetup() {
					vars.push('element', 'parentScope', 'childScope', 'compile');

					var d = injectDashes(specName),
						dt = 'Directive_TemplateGoes_Here',
						attrs = '',
						psProps = '';

					_.each(scope, function (s) {
						var p = injectDashes(s.key.name),
							v = s.value.value.length > 1 ? s.value.value.slice(1) : s.key.name;
						psProps += tabString(4) + 'parentScope.' + v + ' = {};\n';
						attrs += ' ' + p + '="' + v + '"';
					});

					// treat AE or E as elements
					if (restricts.indexOf('E') > -1) {
						dt = '<' + d + attrs + '></' + d + '>';
					}

					// treat A as atributes
					if (restricts === 'A') {
						dt = '<any ' + d + attrs + '></any ' + d + '>';
					}
					var elemScope = scope ? 'isolateScope' : 'scope';

					var cd = '\n' +
						tabString(3) + 'function compileDirective() {\n' +
						tabString(4) + 'element = compile(\'' + dt + '\')(parentScope);\n' +
						tabString(4) + 'parentScope.$digest();\n' +
						tabString(4) + 'childScope = element.'+ elemScope+'();\n' +
						tabString(3) + '}\n';

					t = t.replace('<%SCOPE%>', tabString(4) + 'parentScope = $injector.get(\'$rootScope\').$new();\n' + psProps)
						.replace('<%CREATECOMPILE%>', cd)
						.replace('<%CREATECOMPILEBE%>', tabString(4) + 'compileDirective();');
					cleanupSetup('childScope');
				}

				function controllerSetUp() {
					vars.push('controller', 'controllerScope');
					var controllerInjections = tabString(5) + '$scope: controllerScope';

					_.each(injections, function (inj) {
						if (inj === 'environment') {
							controllerInjections += ',\n' + tabString(5) + inj + ': ' + inj + 'Mock';
						}
						else {
							controllerInjections += ',\n' + tabString(5) + inj + ': ' + inj;
						}
					});

					// custom setup for $uibModal usage
					if (_.contains(angularInjections, '$uibModal')) {
						controllerInjections += ',\n' + tabString(5) + '$uibModal: uibModal';
					}

					controllerInjections += '\n';

					var cc = '\n' +
						tabString(3) + 'function createController() {\n' +
						tabString(4) + 'return controller(\'<%CONTROLLERNAME%>\', {\n' +
						'<%CONTROLLERINJECTIONS%>' +
						tabString(4) + '});\n' +
						tabString(3) + '}\n';

					cc = cc.replace('<%CONTROLLERNAME%>', specName);
					cc = cc.replace('<%CONTROLLERINJECTIONS%>', controllerInjections);
					t = t.replace('<%SCOPE%>', tabString(4) + 'controllerScope = $injector.get(\'$rootScope\').$new();')
						.replace('<%CREATECOMPILE%>', cc)
						.replace('<%CREATECOMPILEBE%>', tabString(4) + 'createController();');
					cleanupSetup('controllerScope');
				}

				function serviceSetup() {
					t = t.replace('<%SCOPE%>', '')
						.replace('<%INITEXPECTS%>', '')
						.replace('<%BESPIES%>', '')
						.replace('<%CREATECOMPILE%>', '')
						.replace('<%CREATECOMPILEBE%>', '')
						.replace('<%CLEANUP%>', '');
				}
			});
		});
		grunt.task.run('usethe:force:default');
	});
};
