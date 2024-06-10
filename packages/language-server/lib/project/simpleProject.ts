import type { URI } from 'vscode-uri';
import type { LanguageServer, ProjectFacade } from '../types';
import type { LanguagePlugin } from '@volar/language-core/lib/types';
import { createLanguage } from '@volar/language-core';
import type { LanguageServiceEnvironment } from '@volar/language-service/lib/types';
import { createUriMap } from '@volar/language-service/lib/utils/uriMap';
import { createLanguageService, type LanguageService } from '@volar/language-service/lib/languageService';


export function createSimpleProject(languagePlugins: LanguagePlugin<URI>[]): ProjectFacade {
	let languageService: LanguageService | undefined;

	return {
		reolveLanguageServiceByUri(server) {
			languageService ??= create(server);
			return languageService;
		},
		getExistingLanguageServices() {
			if (languageService) {
				return [languageService];
			}
			return [];
		},
		reload() {
			languageService?.dispose();
			languageService = undefined;
		},
	};

	function create(server: LanguageServer) {
		const language = createLanguage(
			languagePlugins,
			createUriMap(false),
			uri => {
				const documentKey = server.documents.getSyncedDocumentKey(uri) ?? uri.toString();
				const document = server.documents.documents.get(documentKey);
				if (document) {
					language.scripts.set(uri, document.getSnapshot(), document.languageId);
				}
				else {
					language.scripts.delete(uri);
				}
			},
		);
		return createLanguageService(
			language,
			server.languageServicePlugins,
			createLanguageServiceEnvironment(server, [...server.workspaceFolders.keys()]),
		);
	}
}

export function createLanguageServiceEnvironment(server: LanguageServer, workspaceFolders: URI[]): LanguageServiceEnvironment {
	return {
		workspaceFolders,
		fs: server.fs,
		locale: server.initializeParams?.locale,
		clientCapabilities: server.initializeParams?.capabilities,
		getConfiguration: server.configurationWatcher.getConfiguration,
		onDidChangeConfiguration: server.configurationWatcher.onDidChangeConfiguration,
		onDidChangeWatchedFiles: server.onDidChangeWatchedFiles,
	};
}
