// import { isCodeActionsEnabled } from '@volar/language-core';
import type { URI } from 'vscode-uri';
import type { LanguageServiceContext } from '../types';
import { NoneCancellationToken } from '../utils/cancellation';
import { findOverlapCodeRange, notEmpty } from '../utils/common';
import * as dedupe from '../utils/dedupe';
import { languageFeatureWorker } from '../utils/featureWorkers';
import { transformLocations, transformWorkspaceEdit } from '../utils/transform';
import type { ServiceDiagnosticData } from './provideDiagnostics';
import { isCodeActionsEnabled } from '@volar/language-core/lib/editorFeatures';
import type { CodeAction, CodeActionContext, Range } from 'vscode-languageserver-types';

export interface ServiceCodeActionData {
	uri: string;
	version: number;
	original: Pick<CodeAction, 'data' | 'edit'>;
	pluginIndex: number;
}

export function register(context: LanguageServiceContext) {

	return async (uri: URI, range: Range, codeActionContext: CodeActionContext, token = NoneCancellationToken) => {
		const sourceScript = context.language.scripts.get(uri);
		if (!sourceScript) {
			return;
		}

		const transformedCodeActions = new WeakSet<CodeAction>();

		return await languageFeatureWorker(
			context,
			uri,
			() => ({ range, codeActionContext }),
			function* (map) {
				const _codeActionContext: CodeActionContext = {
					diagnostics: transformLocations(
						codeActionContext.diagnostics,
						range => map.getGeneratedRange(range)
					),
					only: codeActionContext.only,
				};
				const mapped = findOverlapCodeRange(
					map.sourceDocument.offsetAt(range.start),
					map.sourceDocument.offsetAt(range.end),
					map.map,
					isCodeActionsEnabled
				);
				if (mapped) {
					yield {
						range: {
							start: map.embeddedDocument.positionAt(mapped.start),
							end: map.embeddedDocument.positionAt(mapped.end),
						},
						codeActionContext: _codeActionContext,
					};
				}
			},
			async (plugin, document, { range, codeActionContext }) => {
				if (token.isCancellationRequested) {
					return;
				}
				const pluginIndex = context.plugins.indexOf(plugin);
				const diagnostics = codeActionContext.diagnostics.filter(diagnostic => {
					const data: ServiceDiagnosticData | undefined = diagnostic.data;
					if (data && data.version !== document.version) {
						return false;
					}
					return data?.pluginIndex === pluginIndex;
				}).map(diagnostic => {
					const data: ServiceDiagnosticData = diagnostic.data;
					return {
						...diagnostic,
						...data.original,
					};
				});

				const codeActions = await plugin[1].provideCodeActions?.(document, range, {
					...codeActionContext,
					diagnostics,
				}, token);

				codeActions?.forEach(codeAction => {
					codeAction.data = {
						uri: uri.toString(),
						version: document.version,
						original: {
							data: codeAction.data,
							edit: codeAction.edit,
						},
						pluginIndex: context.plugins.indexOf(plugin),
					} satisfies ServiceCodeActionData;
				});

				if (codeActions && plugin[1].transformCodeAction) {
					for (let i = 0; i < codeActions.length; i++) {
						const transformed = plugin[1].transformCodeAction(codeActions[i]);
						if (transformed) {
							codeActions[i] = transformed;
							transformedCodeActions.add(transformed);
						}
					}
				}

				return codeActions;
			},
			actions => actions
				.map(action => {

					if (transformedCodeActions.has(action)) {
						return action;
					}

					if (action.edit) {
						const edit = transformWorkspaceEdit(
							action.edit,
							context,
							'codeAction'
						);
						if (!edit) {
							return;
						}
						action.edit = edit;
					}

					return action;
				})
				.filter(notEmpty),
			arr => dedupe.withCodeAction(arr.flat())
		);
	};
}
