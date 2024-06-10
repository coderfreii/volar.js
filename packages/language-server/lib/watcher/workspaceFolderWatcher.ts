import { URI } from "vscode-uri";
import {  type Holder } from "../server";

function setup(){
	 function registerWorkspaceFolderWatcher(holder: Holder) {
		if (holder.initializeParams?.capabilities.workspace?.workspaceFolders) {
			holder.connection.workspace.onDidChangeWorkspaceFolders(e => {
				for (const folder of e.added) {
					holder.workspaceFolders.set(URI.parse(folder.uri), true);
				}
				for (const folder of e.removed) {
					holder.workspaceFolders.delete(URI.parse(folder.uri));
				}
				holder.projectFacade.reload();
			});
		}
	}

	return {
		registerWorkspaceFolderWatcher
	}
}


export const workspaceFolderWatcherSetup = {
	setup
}