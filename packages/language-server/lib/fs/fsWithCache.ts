import type { FileSystem } from "@volar/language-service/lib/types";
import { createUriMap } from "@volar/language-service/lib/utils/uriMap";
import { URI } from 'vscode-uri';
import * as vscode from 'vscode-languageserver';

const callbackTriggerWhenCachedFileChange = new Set<vscode.NotificationHandler<vscode.DidChangeWatchedFilesParams>>();


function setup(fs: FileSystem): FileSystem {

	const readFileCache = createUriMap<ReturnType<FileSystem['readFile']>>();
	const statCache = createUriMap<ReturnType<FileSystem['stat']>>();
	const readDirectoryCache = createUriMap<ReturnType<FileSystem['readDirectory']>>();

	onDidChangeWatchedFiles(({ changes }) => {
		for (const change of changes) {
			const changeUri = URI.parse(change.uri);
			const dir = URI.parse(change.uri.substring(0, change.uri.lastIndexOf('/')));
			if (change.type === vscode.FileChangeType.Deleted) {
				readFileCache.set(changeUri, undefined);
				statCache.set(changeUri, undefined);
				readDirectoryCache.delete(dir);
			}
			else if (change.type === vscode.FileChangeType.Changed) {
				readFileCache.delete(changeUri);
				statCache.delete(changeUri);
			}
			else if (change.type === vscode.FileChangeType.Created) {
				readFileCache.delete(changeUri);
				statCache.delete(changeUri);
				readDirectoryCache.delete(dir);
			}
		}
	});

	return {
		readFile: uri => {
			if (!readFileCache.has(uri)) {
				readFileCache.set(uri, fs.readFile(uri));
			}
			return readFileCache.get(uri)!;
		},
		stat: uri => {
			if (!statCache.has(uri)) {
				statCache.set(uri, fs.stat(uri));
			}
			return statCache.get(uri)!;
		},
		readDirectory: uri => {
			if (!readDirectoryCache.has(uri)) {
				readDirectoryCache.set(uri, fs.readDirectory(uri));
			}
			return readDirectoryCache.get(uri)!;
		},
	};
}


function onDidChangeWatchedFiles(cb: vscode.NotificationHandler<vscode.DidChangeWatchedFilesParams>) {
	callbackTriggerWhenCachedFileChange.add(cb);
	return {
		dispose: () => {
			callbackTriggerWhenCachedFileChange.delete(cb);
		},
	};
}


export const fsWithCache = {
	setup,
	callbackTriggerWhenCachedFileChange,
	onDidChangeWatchedFiles
}