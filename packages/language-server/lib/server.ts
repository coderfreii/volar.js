import { configure as configureHttpRequests } from 'request-light';
import * as vscode from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { registerEditorFeatures } from './register/registerEditorFeatures';
import { registerLanguageFeatures } from './register/registerLanguageFeatures';
import type { ProjectFacade, VolarInitializeResult } from './types';
import type { FileSystem, LanguageServicePlugin } from '@volar/language-service/lib/types';
import { createUriMap } from '@volar/language-service/lib/utils/uriMap';
import { fsWithCache } from './fs/fsWithCache';
import { workspaceFolderWatcherSetup } from './watcher/workspaceFolderWatcher';
import { configurationWatcherSetup } from './watcher/configurationWatcher';
import { FileWatchersSetup } from './watcher/filerWatcher';
import { documentsSetup } from './uri/documents';
import { diagnosticsSetup } from './diagnostics';


export type Holder = {
	initializeParams: vscode.InitializeParams;
	initializeResult: VolarInitializeResult;
	projectFacade: ProjectFacade;
	languageServicePlugins: LanguageServicePlugin[];
	workspaceFolders: ReturnType<typeof createUriMap<boolean>>,
	connection: vscode.Connection;
	pullModelDiagnostics: boolean;
};


export function createServerBase(
	connection: vscode.Connection,
	fs: FileSystem,
) {

	const holder: Holder = {
		initializeParams: undefined as unknown as vscode.InitializeParams,
		initializeResult: undefined as unknown as VolarInitializeResult,
		projectFacade: undefined as unknown as ProjectFacade,
		languageServicePlugins: undefined as unknown as LanguageServicePlugin[],
		workspaceFolders: createUriMap<boolean>(),
		connection,
		pullModelDiagnostics: false
	};

	const configurationWatcher = configurationWatcherSetup.setup(holder);
	const workspaceFolderWatcher = workspaceFolderWatcherSetup.setup();
	const FilerWatcher = FileWatchersSetup.setup(holder);
	const documents = documentsSetup.setup(holder);


	const server = {
		documents,
		fs: fsWithCache.setup(fs),
		onDidChangeWatchedFiles: fsWithCache.onDidChangeWatchedFiles,
		initialize,
		initialized,
		shutdown,
		configurationWatcher,
		filerWatcher: FilerWatcher,
		get clearPushDiagnostics() {
			return diagnosticGetter().clearPushDiagnostics;
		},
		get refresh() {
			return diagnosticGetter().refresh;
		},
		get pullModelDiagnostics() {
			return holder.pullModelDiagnostics;
		},
		get connection() {
			return holder.connection;
		},
		get workspaceFolders() {
			return holder.workspaceFolders;
		},
		get initializeParams() {
			return holder.initializeParams;
		},
		get initializeResult() {
			return holder.initializeResult;
		},
		get projectFacade() {
			return holder.projectFacade;
		},
		get languageServicePlugins() {
			return holder.languageServicePlugins;
		},
	};


	const diagnostic = diagnosticsSetup.setup(holder, configurationWatcher, documents, server);

	function diagnosticGetter() {
		return diagnostic;
	}


	return server;


	function initialize(
		initializeParams: vscode.InitializeParams,
		languageServicePlugins: LanguageServicePlugin[],
		projectFacade: ProjectFacade,
		options?: {
			pullModelDiagnostics?: boolean;
		},
	) {
		holder.initializeParams = initializeParams;
		holder.languageServicePlugins = languageServicePlugins;
		holder.projectFacade = projectFacade;
		holder.pullModelDiagnostics = options?.pullModelDiagnostics ?? false;


		initializedWorkSpaceFolder(initializeParams);


		setupInitializeResult();


		registerEditorFeatures(server);
		registerLanguageFeatures(server);


		return server.initializeResult;
	}

	function initialized() {
		workspaceFolderWatcher.registerWorkspaceFolderWatcher(holder);
		configurationWatcher.registerConfigurationWatcher();
		updateHttpSettings();
		configurationWatcher.onDidChangeConfiguration(updateHttpSettings);
	}

	async function shutdown() {
		server.projectFacade.reload();
	}

	async function updateHttpSettings() {
		const httpSettings = await configurationWatcher.getConfiguration<{ proxyStrictSSL: boolean; proxy: string; }>('http');
		configureHttpRequests(httpSettings?.proxy, httpSettings?.proxyStrictSSL ?? false);
	}

	function initializedWorkSpaceFolder(initializeParams: vscode.InitializeParams) {
		if (initializeParams.workspaceFolders?.length) {
			for (const folder of initializeParams.workspaceFolders) {
				server.workspaceFolders.set(URI.parse(folder.uri), true);
			}
		}
		else if (initializeParams.rootUri) {
			server.workspaceFolders.set(URI.parse(initializeParams.rootUri), true);
		}
		else if (initializeParams.rootPath) {
			server.workspaceFolders.set(URI.file(initializeParams.rootPath), true);
		}
	}

	function setupInitializeResult() {
		holder.initializeResult = { capabilities: {} };

		const pluginCapabilities = resolveCapabilitiesFromPlugin();

		server.initializeResult.capabilities = {
			get textDocumentSync(): vscode.TextDocumentSyncKind {
				return vscode.TextDocumentSyncKind.Incremental;
			},
			workspace: {
				// #18
				workspaceFolders: {
					supported: true,
					changeNotifications: true,
				},
			},
			...pluginCapabilities
		};

		if (!server.pullModelDiagnostics && server.initializeResult.capabilities.diagnosticProvider) {
			server.initializeResult.capabilities.diagnosticProvider = undefined;
			diagnostic.activateServerPushDiagnostics(holder.projectFacade);
		}

	}

	function resolveCapabilitiesFromPlugin(): vscode.ServerCapabilities<any> {
		const capabilitiesArr = server.languageServicePlugins.map(plugin => plugin.capabilities);

		const capabilities = {
			selectionRangeProvider: capabilitiesArr.some(data => data.selectionRangeProvider) ? true : undefined,
			foldingRangeProvider: capabilitiesArr.some(data => data.foldingRangeProvider) ? true : undefined,
			linkedEditingRangeProvider: capabilitiesArr.some(data => data.linkedEditingRangeProvider) ? true : undefined,
			colorProvider: capabilitiesArr.some(data => data.colorProvider) ? true : undefined,
			documentSymbolProvider: capabilitiesArr.some(data => data.documentSymbolProvider) ? true : undefined,
			documentFormattingProvider: capabilitiesArr.some(data => data.documentFormattingProvider) ? true : undefined,
			documentRangeFormattingProvider: capabilitiesArr.some(data => data.documentFormattingProvider) ? true : undefined,
			referencesProvider: capabilitiesArr.some(data => data.referencesProvider) ? true : undefined,
			implementationProvider: capabilitiesArr.some(data => data.implementationProvider) ? true : undefined,
			definitionProvider: capabilitiesArr.some(data => data.definitionProvider) ? true : undefined,
			typeDefinitionProvider: capabilitiesArr.some(data => data.typeDefinitionProvider) ? true : undefined,
			callHierarchyProvider: capabilitiesArr.some(data => data.callHierarchyProvider) ? true : undefined,
			hoverProvider: capabilitiesArr.some(data => data.hoverProvider) ? true : undefined,
			documentHighlightProvider: capabilitiesArr.some(data => data.documentHighlightProvider) ? true : undefined,
			workspaceSymbolProvider: capabilitiesArr.some(data => data.workspaceSymbolProvider) ? true : undefined,
			renameProvider: capabilitiesArr.some(data => data.renameProvider)
				? { prepareProvider: capabilitiesArr.some(data => data.renameProvider?.prepareProvider) }
				: undefined,
			documentLinkProvider: capabilitiesArr.some(data => data.documentLinkProvider)
				? { resolveProvider: capabilitiesArr.some(data => data.documentLinkProvider?.resolveProvider) }
				: undefined,
			codeLensProvider: capabilitiesArr.some(data => data.codeLensProvider)
				? { resolveProvider: capabilitiesArr.some(data => data.codeLensProvider?.resolveProvider) }
				: undefined,
			inlayHintProvider: capabilitiesArr.some(data => data.inlayHintProvider)
				? { resolveProvider: capabilitiesArr.some(data => data.inlayHintProvider?.resolveProvider) }
				: undefined,
			signatureHelpProvider: capabilitiesArr.some(data => data.signatureHelpProvider)
				? {

					triggerCharacters: [...new Set(capabilitiesArr.map(data => data.signatureHelpProvider?.triggerCharacters ?? []).flat())],
					retriggerCharacters: [...new Set(capabilitiesArr.map(data => data.signatureHelpProvider?.retriggerCharacters ?? []).flat())],
				}
				: undefined,
			completionProvider: capabilitiesArr.some(data => data.completionProvider)
				? {
					resolveProvider: capabilitiesArr.some(data => data.completionProvider?.resolveProvider),
					triggerCharacters: [...new Set(capabilitiesArr.map(data => data.completionProvider?.triggerCharacters ?? []).flat())],
				}
				: undefined,
			semanticTokensProvider: capabilitiesArr.some(data => data.semanticTokensProvider)
				? {
					range: true,
					full: false,
					legend: {
						tokenTypes: [...new Set(capabilitiesArr.map(data => data.semanticTokensProvider?.legend?.tokenTypes ?? []).flat())],
						tokenModifiers: [...new Set(capabilitiesArr.map(data => data.semanticTokensProvider?.legend?.tokenModifiers ?? []).flat())],
					},
				}
				: undefined,
			codeActionProvider: capabilitiesArr.some(data => data.codeActionProvider)
				? {
					resolveProvider: capabilitiesArr.some(data => data.codeActionProvider?.resolveProvider),
					codeActionKinds: capabilitiesArr
						.filter(data => data.codeActionProvider)
						.every(data => data.codeActionProvider?.codeActionKinds)
						? [...new Set(capabilitiesArr.map(data => data.codeActionProvider?.codeActionKinds ?? []).flat())]
						: undefined,
				}
				: undefined,
			diagnosticProvider: capabilitiesArr.some(data => data.diagnosticProvider)
				? {
					interFileDependencies: true,
					workspaceDiagnostics: false,
				}
				: undefined,
			documentOnTypeFormattingProvider: capabilitiesArr.some(data => data.documentOnTypeFormattingProvider)
				? {
					firstTriggerCharacter: [...new Set(capabilitiesArr.map(data => data.documentOnTypeFormattingProvider?.triggerCharacters ?? []).flat())][0],
					moreTriggerCharacter: [...new Set(capabilitiesArr.map(data => data.documentOnTypeFormattingProvider?.triggerCharacters ?? []).flat())].slice(1),
				}
				: undefined,
			autoInsertion: capabilitiesArr.some(data => data.autoInsertionProvider)
				? wrapper()
				:
				undefined
		};


		function wrapper() {
			const allTriggerCharacters: string[] = [];
			const allConfigurationSections: (string | undefined)[] = [];
			for (const data of capabilitiesArr) {
				if (data.autoInsertionProvider) {
					const { triggerCharacters, configurationSections } = data.autoInsertionProvider;
					allTriggerCharacters.push(...triggerCharacters);
					if (configurationSections) {
						if (configurationSections.length !== triggerCharacters.length) {
							throw new Error('configurationSections.length !== triggerCharacters.length');
						}
						allConfigurationSections.push(...configurationSections);
					}
					else {
						allConfigurationSections.push(...triggerCharacters.map(() => undefined));
					}
				}
			}
			return {
				triggerCharacters: allTriggerCharacters,
				configurationSections: allConfigurationSections,
			};
		}

		return capabilities;
	}
}
