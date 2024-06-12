import * as path from 'path-browserify';
import type * as ts from 'typescript';
import * as vscode from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import type { LanguageServer, ProjectFacade } from '../types';
import { getInferredCompilerOptions } from './inferredCompilerOptions';
import { createLanguageServiceEnvironment } from './simpleProject';
import { ProjectExposeContext, createTypeScriptProject, type  TypeScriptProject } from './typescriptProject';
import type { LanguagePlugin } from '@volar/language-core/lib/types';
import { type LanguageServiceEnvironment, type ProviderResult, FileType } from '@volar/language-service/lib/types';
import { createUriMap, type UriMap } from '@volar/language-service/lib/utils/uriMap';

const rootTsConfigNames = ['tsconfig.json', 'jsconfig.json'];

export type LanguagePluginProvider = (
	serviceEnv: LanguageServiceEnvironment,
	projectContext: ProjectExposeContext
) => ProviderResult<LanguagePlugin<URI>[]>;


export function createTypeScriptProjectFacade(
	ts: typeof import('typescript'),
	tsLocalized: ts.MapLike<string> | undefined,
	languagePluginSProvider: LanguagePluginProvider,
) {
	let initialized = false;

	const { asFileName, asUri } = createUriConverter();

	const configuredProjects = createUriMap<Promise<TypeScriptProject>>();

	const inferredProjects = createUriMap<Promise<TypeScriptProject>>();

	const rootTsConfigs = new Set<string>();

	const searchedDirs = new Set<string>();

	const projects: ProjectFacade = {
		async reolveLanguageServiceByUri(server, uri) {
			if (!initialized) {
				initialized = true;
				initialize(server);
			}

			const tsconfig = await findMatchTSConfigAndInitialAllRelativeProject(server, uri);
			if (tsconfig) {
				const project = await getOrCreateConfiguredProject(server, tsconfig);
				return project.languageService;
			} else {
				const workspaceFolder = getWorkspaceFolder(uri, server.workspaceFolders);
				const project = await getOrCreateInferredProject(server, uri, workspaceFolder);
				return project.languageService;
			}
		},
		async getExistingLanguageServices() {
			const projects = await Promise.all([
				...configuredProjects.values() ?? [],
				...inferredProjects.values() ?? [],
			]);
			return projects.map(project => project.languageService);
		},
		reload() {
			for (const project of [
				...configuredProjects.values() ?? [],
				...inferredProjects.values() ?? [],
			]) {
				project.then(p => p.dispose());
			}
			configuredProjects.clear();
			inferredProjects.clear();
		},
	};

	return projects;
	function initialize(server: LanguageServer) {
		server.onDidChangeWatchedFiles(({ changes }) => {
			const tsConfigChanges = changes.filter(change => rootTsConfigNames.includes(change.uri.substring(change.uri.lastIndexOf('/') + 1)));

			for (const change of tsConfigChanges) {
				const changeUri = URI.parse(change.uri);
				const changeFileName = asFileName(changeUri);
				if (change.type === vscode.FileChangeType.Created) {
					rootTsConfigs.add(changeFileName);
				}
				else if ((change.type === vscode.FileChangeType.Changed || change.type === vscode.FileChangeType.Deleted) && configuredProjects.has(changeUri)) {
					if (change.type === vscode.FileChangeType.Deleted) {
						rootTsConfigs.delete(changeFileName);
					}
					const project = configuredProjects.get(changeUri);
					configuredProjects.delete(changeUri);
					project?.then(project => project.dispose());
				}
			}

			if (tsConfigChanges.length) {
				server.clearPushDiagnostics();
			}
			server.refresh(projects);
		});
	}

	async function findMatchTSConfigAndInitialAllRelativeProject(server: LanguageServer, uri: URI) {

		const fileName = asFileName(uri);

		let dir = path.dirname(fileName);

		//findAll root config
		while (true) {
			if (searchedDirs.has(dir)) {
				break;
			}
			searchedDirs.add(dir);
			for (const tsConfigName of rootTsConfigNames) {
				const tsconfigPath = path.join(dir, tsConfigName);
				if ((await server.fs.stat?.(asUri(tsconfigPath)))?.type === FileType.File) {
					rootTsConfigs.add(tsconfigPath);
				}
			}
			dir = path.dirname(dir);
		}

		await prepareClosestRootParsedCommandLine();

		return await findDirectIncludeTsconfig() ?? await findIndirectReferenceTsconfig();

		async function prepareClosestRootParsedCommandLine() {

			let matches: string[] = [];

			for (const rootTsConfig of rootTsConfigs) {
				if (isFileInDir(fileName, path.dirname(rootTsConfig))) {
					matches.push(rootTsConfig);
				}
			}

			matches = matches.sort((a, b) => sortTSConfigs(fileName, a, b));

			if (matches.length) {
				//inital closest one 
				await getOrCreateConfiguredProject(server, matches[0]);
			}
		}
		function findIndirectReferenceTsconfig() {
			return findTSConfig(async tsconfig => {
				const tsconfigUri = asUri(tsconfig);
				const project = await configuredProjects.get(tsconfigUri);
				return project?.askedFiles.has(uri) ?? false;
			});
		}
		function findDirectIncludeTsconfig() {
			return findTSConfig(async tsconfig => {
				const map = createUriMap<boolean>();
				const parsedCommandLine = await getParsedCommandLineAndinitalProjectIfNeed(tsconfig);
				for (const fileName of parsedCommandLine?.fileNames ?? []) {
					const uri = asUri(fileName);
					map.set(uri, true);
				}
				return map.has(uri);
			});
		}
		async function findTSConfig(match: (tsconfig: string) => Promise<boolean> | boolean) {

			const checked = new Set<string>();

			for (const rootTsConfig of [...rootTsConfigs].sort((a, b) => sortTSConfigs(fileName, a, b))) {
				const tsconfigUri = asUri(rootTsConfig);
				const project = await configuredProjects.get(tsconfigUri);
				if (project) {

					let chains = await resolveReferencesChains(
						project.getParsedCommandLine(),
						rootTsConfig,
						[]);

					// This is to be consistent with tsserver behavior
					chains = chains.reverse();

					for (const chain of chains) {   
						for (let i = chain.length - 1; i >= 0; i--) {   // traverse in  reverse order 
							const tsconfig = chain[i];

							if (checked.has(tsconfig)) {
								continue;
							}
							checked.add(tsconfig);

							if (await match(tsconfig)) { // we will get reference one  because  traversing  in  reverse order 
								return tsconfig;
							}
						}
					}
				}
			}
		}
		async function resolveReferencesChains(parsedCommandLine: ts.ParsedCommandLine, tsConfig: string, before: string[]) {

			if (parsedCommandLine.projectReferences?.length) {

				const newChains: string[][] = [];

				for (const projectReference of parsedCommandLine.projectReferences) {

					let tsConfigPath = projectReference.path.replace(/\\/g, '/');

					// fix https://github.com/johnsoncodehk/volar/issues/712
					if ((await server.fs.stat?.(asUri(tsConfigPath)))?.type === FileType.File) {
						const newTsConfigPath = path.join(tsConfigPath, 'tsconfig.json');
						const newJsConfigPath = path.join(tsConfigPath, 'jsconfig.json');
						if ((await server.fs.stat?.(asUri(newTsConfigPath)))?.type === FileType.File) {
							tsConfigPath = newTsConfigPath;
						}
						else if ((await server.fs.stat?.(asUri(newJsConfigPath)))?.type === FileType.File) {
							tsConfigPath = newJsConfigPath;
						}
					}

					const beforeIndex = before.indexOf(tsConfigPath); // cycle
					if (beforeIndex >= 0) {
						newChains.push(before.slice(0, Math.max(beforeIndex, 1)));
					}
					else {  // must run in first round
						const referenceParsedCommandLine = await getParsedCommandLineAndinitalProjectIfNeed(tsConfigPath);
						if (referenceParsedCommandLine) {
							for (
								const chain of await resolveReferencesChains(
									referenceParsedCommandLine,
									tsConfigPath,
									[...before, tsConfig])
							) {
								newChains.push(chain);
							}
						}
					}
				}

				return newChains;
			}
			else {
				return [[...before, tsConfig]];
			}
		}
		async function getParsedCommandLineAndinitalProjectIfNeed(tsConfig: string) {
			const project = await getOrCreateConfiguredProject(server, tsConfig);
			return project?.getParsedCommandLine();
		}
	}

	function getOrCreateConfiguredProject(server: LanguageServer, tsconfig: string) {
		tsconfig = tsconfig.replace(/\\/g, '/');
		const tsconfigUri = asUri(tsconfig);
		let projectPromise = configuredProjects.get(tsconfigUri);
		if (!projectPromise) {
			const workspaceFolder = getWorkspaceFolder(tsconfigUri, server.workspaceFolders);
			const serviceEnv = createLanguageServiceEnvironment(server, [workspaceFolder]);
			projectPromise = createTypeScriptProject(
				ts,
				tsLocalized,
				tsconfig,
				server,
				serviceEnv,
				workspaceFolder,
				languagePluginSProvider,
				{ asUri, asFileName },
			);
			configuredProjects.set(tsconfigUri, projectPromise);
		}
		return projectPromise;
	}

	async function getOrCreateInferredProject(server: LanguageServer, uri: URI, workspaceFolder: URI) {

		if (!inferredProjects.has(workspaceFolder)) {
			inferredProjects.set(workspaceFolder, (async () => {
				const inferOptions = await getInferredCompilerOptions(server);
				const serviceEnv = createLanguageServiceEnvironment(server, [workspaceFolder]);
				return createTypeScriptProject(
					ts,
					tsLocalized,
					inferOptions,
					server,
					serviceEnv,
					workspaceFolder,
					languagePluginSProvider,
					{ asUri, asFileName },
				);
			})());
		}

		const project = await inferredProjects.get(workspaceFolder)!;

		project.tryAddFile(asFileName(uri));

		return project;
	}
}

export function createUriConverter() {
	const encodeds = new Map<string, URI>();

	return {
		asFileName,
		asUri,
	};

	function asFileName(parsed: URI) {
		if (parsed.scheme === 'file') {
			return parsed.fsPath.replace(/\\/g, '/');
		}
		const encoded = encodeURIComponent(`${parsed.scheme}://${parsed.authority}`);
		encodeds.set(encoded, parsed);
		return `/${encoded}${parsed.path}`;
	}

	function asUri(fileName: string) {
		for (const [encoded, uri] of encodeds) {
			const prefix = `/${encoded}`;
			if (fileName.startsWith(prefix)) {
				return URI.from({
					scheme: uri.scheme,
					authority: uri.authority,
					path: fileName.substring(prefix.length),
				});
			}
		}
		return URI.file(fileName);
	}
}

export function sortTSConfigs(file: string, a: string, b: string) {

	const inA = isFileInDir(file, path.dirname(a));
	const inB = isFileInDir(file, path.dirname(b));

	if (inA !== inB) {
		const aWeight = inA ? 1 : 0;
		const bWeight = inB ? 1 : 0;
		return bWeight - aWeight;
	}

	const aLength = a.split('/').length;
	const bLength = b.split('/').length;

	if (aLength === bLength) {
		const aWeight = path.basename(a) === 'tsconfig.json' ? 1 : 0;
		const bWeight = path.basename(b) === 'tsconfig.json' ? 1 : 0;
		return bWeight - aWeight;
	}

	return bLength - aLength;
}

export function isFileInDir(fileName: string, dir: string) {
	const relative = path.relative(dir, fileName);
	return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function getWorkspaceFolder(uri: URI, workspaceFolders: UriMap<boolean>) {
	while (true) {
		if (workspaceFolders.has(uri)) {
			return uri;
		}
		const next = uri.with({ path: uri.path.substring(0, uri.path.lastIndexOf('/')) });
		if (next.path === uri.path) {
			break;
		}
		uri = next;
	}

	for (const folder of workspaceFolders.keys()) {
		return folder;
	}

	return uri.with({ path: '/' });
}
