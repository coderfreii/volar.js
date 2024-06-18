import { isAutoInsertEnabled } from '@volar/language-core/lib/editorFeatures';
import type * as vscode from 'vscode-languageserver-protocol';
import type { URI } from 'vscode-uri';
import type { LanguageServiceContext } from '../types';
import { NoneCancellationToken } from '../utils/cancellation';
import { languageFeatureWorker } from '../utils/featureWorkers';

export function register(context: LanguageServiceContext) {

	return (uri: URI, selection: vscode.Position, change: { rangeOffset: number; rangeLength: number; text: string; }, token = NoneCancellationToken) => {

		return languageFeatureWorker(
			context,
			uri,
			() => ({ selection, change }),
			function* (map) {
				for (const mappedPosition of map.getGeneratedPositions(selection, isAutoInsertEnabled)) {
					for (const mapped of map.map.getGeneratedOffsets(change.rangeOffset)) {
						yield {
							selection: mappedPosition,
							change: {
								text: change.text,
								rangeOffset: mapped[0],
								rangeLength: change.rangeLength,
							},
						};
						break;
					}
				}
			},
			(plugin, document, args) => {
				if (token.isCancellationRequested) {
					return;
				}
				return plugin[1].provideAutoInsertSnippet?.(document, args.selection, args.change, token);
			},
			snippet => snippet
		);
	};
}
