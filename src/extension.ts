import * as vscode from 'vscode';
import { run } from './runner';
import { debug } from './debugger';

//
// activate() is entry point for condor
//
export function activate(context: vscode.ExtensionContext) {
	console.log('condor extension running');
	
	// condor.run; must match package.json
	const runnerDisposable = vscode.commands.registerCommand('condor.run', run);
	const debuggerDisposable = vscode.commands.registerCommand('condor.debug', debug);

	context.subscriptions.push(runnerDisposable);
	context.subscriptions.push(debuggerDisposable);
}

//
// cleanup after condor gets deactivated
//
export function deactivate() {}