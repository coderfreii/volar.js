
import * as vscode from 'vscode-languageserver';
import type { Holder } from '../server';


const configurations = new Map<string, Promise<any>>();
const didChangeConfigurationCallbacks = new Set<vscode.NotificationHandler<vscode.DidChangeConfigurationParams>>();

function setup(holder: Holder) {

	function registerConfigurationWatcher() {
		const didChangeConfiguration = holder.initializeParams?.capabilities.workspace?.didChangeConfiguration;
		if (didChangeConfiguration) {
			holder.connection.onDidChangeConfiguration(params => {
				configurations.clear();
				for (const cb of didChangeConfigurationCallbacks) {
					cb(params);
				}
			});
			if (didChangeConfiguration.dynamicRegistration) {
				holder.connection.client.register(vscode.DidChangeConfigurationNotification.type);
			}
		}
	}



	function onDidChangeConfiguration(cb: vscode.NotificationHandler<vscode.DidChangeConfigurationParams>) {
		didChangeConfigurationCallbacks.add(cb);
		return {
			dispose() {
				didChangeConfigurationCallbacks.delete(cb);
			},
		};
	}

	function getConfiguration<T>(section: string, scopeUri?: string): Promise<T | undefined> {
		if (!holder.initializeParams?.capabilities.workspace?.configuration) {
			return Promise.resolve(undefined);
		}
		if (!scopeUri && holder.initializeParams.capabilities.workspace?.didChangeConfiguration) {
			if (!configurations.has(section)) {
				configurations.set(section, getConfigurationWorker(section, scopeUri));
			}
			return configurations.get(section)!;
		}
		return getConfigurationWorker(section, scopeUri);
	}

	async function getConfigurationWorker(section: string, scopeUri?: string) {
		return (await holder.connection.workspace.getConfiguration({ scopeUri, section })) ?? undefined /* replace null to undefined */;
	}


	const configurationWatcher = {
		onDidChangeConfiguration,
		registerConfigurationWatcher,
		configurations,
		didChangeConfigurationCallbacks,
		getConfiguration
	};

	return configurationWatcher;
}



export const configurationWatcherSetup = {
	setup
};
