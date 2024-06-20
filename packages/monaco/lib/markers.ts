import type { editor } from 'monaco-types';
import type { Diagnostic } from 'vscode-languageserver-protocol';

export const markers = new WeakMap<editor.IMarkerData, Diagnostic>();
