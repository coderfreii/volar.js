// import type { Diagnostic } from '@volar/language-service';
import type { editor } from 'monaco-types';
// import type { Diagnostic } from 'typescript';
import type { Diagnostic } from 'vscode-languageserver-protocol';

export const markers = new WeakMap<editor.IMarkerData, Diagnostic>();
