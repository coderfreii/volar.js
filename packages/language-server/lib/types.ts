import type { URI } from 'vscode-uri';
import type { createServerBase } from './server';
import type { LanguageService } from '@volar/language-service/lib/languageService';
import type { ProviderResult } from '@volar/language-service/lib/types';
import type { InitializeResult } from 'vscode-languageserver-protocol';

export interface ProjectFacade {
	setup(server: LanguageServer): void;
	getLanguageService(uri: URI): ProviderResult<LanguageService>;
	getExistingLanguageServices(): ProviderResult<LanguageService[]>;
	reload(): void;
}

export type LanguageServer = ReturnType<typeof createServerBase>;

export interface VolarInitializeResult extends InitializeResult {
	autoInsertion?: {
		triggerCharacters: string[];
		configurationSections: (string | null)[];
	};
};
