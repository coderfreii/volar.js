import { URI } from "vscode-uri";
import type { Holder } from "./server";
import type { LanguageServer, ProjectFacade } from "./types";
import { sleep } from "@volar/language-service/lib/utils/common";
import * as vscode from 'vscode-languageserver';
import { configurationWatcherSetup } from "./watcher/configurationWatcher";
import { documentsSetup } from "./uri/documents";

let documentUpdatedReq = 0;
let semanticTokensReq = 0;


function setup(
	holder: Holder
	, configurationWatcher: ReturnType<typeof configurationWatcherSetup.setup>
	, documentUri: ReturnType<typeof documentsSetup.setup>
	, server: LanguageServer
) {

	function activateServerPushDiagnostics(projects: ProjectFacade) {
		documentUri.documents.onDidChangeContent(({ document }) => {
			pushAllDiagnostics(projects, document.uri);
		});
		documentUri.documents.onDidClose(({ document }) => {
			holder.connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
		});
		configurationWatcher.onDidChangeConfiguration(() => refresh(projects));
	}

	function clearPushDiagnostics() {
		if (!holder.pullModelDiagnostics) {
			for (const document of documentUri.documents.all()) {
				holder.connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
			}
		}
	}

	async function pushAllDiagnostics(projects: ProjectFacade, docUri?: string) {
		const req = ++documentUpdatedReq;
		const delay = 250;
		const token: vscode.CancellationToken = {
			get isCancellationRequested() {
				return req !== documentUpdatedReq;
			},
			onCancellationRequested: vscode.Event.None,
		};
		const changeDoc = docUri ? documentUri.documents.get(docUri) : undefined;
		const otherDocs = [...documentUri.documents.all()].filter(doc => doc !== changeDoc);

		if (changeDoc) {
			await sleep(delay);
			if (token.isCancellationRequested) {
				return;
			}
			await pushDiagnostics(projects, changeDoc.uri, changeDoc.version, token);
		}

		for (const doc of otherDocs) {
			await sleep(delay);
			if (token.isCancellationRequested) {
				break;
			}
			await pushDiagnostics(projects, doc.uri, doc.version, token);
		}
	}


	async function pushDiagnostics(projects: ProjectFacade, uriStr: string, version: number, cancel: vscode.CancellationToken) {
		const uri = URI.parse(uriStr);
		const languageService = (await projects.reolveLanguageServiceByUri(uri));
		const errors = await languageService.doValidation(uri, cancel, result => {
			holder.connection.sendDiagnostics({ uri: uriStr, diagnostics: result, version });
		});

		holder.connection.sendDiagnostics({ uri: uriStr, diagnostics: errors, version });
	}


	async function refresh(projects: ProjectFacade) {

		const req = ++semanticTokensReq;

		if (!holder.pullModelDiagnostics) {
			await pushAllDiagnostics(projects);
		}

		const delay = 250;
		await sleep(delay);

		if (req === semanticTokensReq) {
			if (holder.initializeParams?.capabilities.workspace?.semanticTokens?.refreshSupport) {
				holder.connection.languages.semanticTokens.refresh();
			}
			if (holder.initializeParams?.capabilities.workspace?.inlayHint?.refreshSupport) {
				holder.connection.languages.inlayHint.refresh();
			}
			if (holder.pullModelDiagnostics && holder.initializeParams?.capabilities.workspace?.diagnostics?.refreshSupport) {
				holder.connection.languages.diagnostics.refresh();
			}
		}
	}

	return {
		activateServerPushDiagnostics,
		clearPushDiagnostics,
		refresh
	};
}


export const diagnosticsSetup = {
	setup
};