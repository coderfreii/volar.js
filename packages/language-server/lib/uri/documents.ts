import { SnapshotDocument } from "@volar/snapshot-document/lib/snapshotDocument";
import type { Holder } from "../server";
import * as vscode from 'vscode-languageserver';
import { URI } from "vscode-uri";


const syncedDocumentParsedUriToUri = new Map<string, string>();

function setup(holder: Holder) {

	const documents = new vscode.TextDocuments({
		create(uri, languageId, version, text) {
			return new SnapshotDocument(uri, languageId, version, text);
		},
		update(snapshot, contentChanges, version) {
			snapshot.update(contentChanges, version);
			return snapshot;
		},
	});

	documents.listen(holder.connection);
	documents.onDidOpen(({ document }) => {
		const parsedUri = URI.parse(document.uri);
		syncedDocumentParsedUriToUri.set(parsedUri.toString(), document.uri);
	});
	documents.onDidClose(e => {
		syncedDocumentParsedUriToUri.delete(URI.parse(e.document.uri).toString());
	});

	return {
		documents,
		getSyncedDocumentKey
	};



	function getSyncedDocumentKey(uri: URI) {
		const originalUri = syncedDocumentParsedUriToUri.get(uri.toString());
		if (originalUri) {
			return originalUri;
		}
	}

}



export const documentsSetup = {
	setup
};