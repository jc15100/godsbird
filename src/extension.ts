import * as vscode from 'vscode';
import { run } from './runner';
import { debug } from './debugger';
import { CondorTextEditorProvider } from './editor';

//
// activate() is entry point for condor
//
export function activate(context: vscode.ExtensionContext) {
	console.log('condor extension running');
	
	// condor.run; must match package.json
	const runnerDisposable = vscode.commands.registerCommand('condor.run', run);
	const debuggerDisposable = vscode.commands.registerCommand('condor.debug', debug);

	const customEditorProvider = vscode.window.registerCustomEditorProvider('condor.editor', new CondorTextEditorProvider(context));

	context.subscriptions.push(runnerDisposable);
	context.subscriptions.push(debuggerDisposable);
	context.subscriptions.push(customEditorProvider);
}

//
// cleanup after condor gets deactivated
//
export function deactivate() {}