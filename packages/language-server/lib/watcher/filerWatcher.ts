
import * as vscode from 'vscode-languageserver';
import type { Holder } from '../server';
import { fsWithCache } from '../fs/fsWithCache';


function setup(holder: Holder){
	function watchFiles(patterns: string[]) {
		const didChangeWatchedFiles = holder.initializeParams?.capabilities.workspace?.didChangeWatchedFiles;
		const fileOperations = holder.initializeParams?.capabilities.workspace?.fileOperations;
		if (didChangeWatchedFiles) {
			holder.connection.onDidChangeWatchedFiles(e => {
				for (const cb of fsWithCache.callbackTriggerWhenCachedFileChange) {
					cb(e);
				}
			});
			if (didChangeWatchedFiles.dynamicRegistration) {
				holder.connection.client.register(vscode.DidChangeWatchedFilesNotification.type, {
					watchers: patterns.map(pattern => ({ globPattern: pattern })),
				});
			}
		}
		if (fileOperations?.dynamicRegistration && fileOperations.willRename) {
			holder.connection.client.register(vscode.WillRenameFilesRequest.type, {
				filters: patterns.map(pattern => ({ pattern: { glob: pattern } })),
			});
		}
	}

	return {
		watchFiles
	}
}


export const FileWatchersSetup = {
	setup
}