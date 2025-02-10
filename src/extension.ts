import * as vscode from 'vscode';
import { run } from './runner';
import { debug, TxtDebugConfigurationProvider, InlineDebugAdapterFactory } from './debugger';
import * as fs from 'fs';

// import { CondorTextEditorProvider } from './editor';

//
// activate() is entry point for condor
//
export function activate(context: vscode.ExtensionContext) {
	console.log('condor extension running');
	
	// condor.run; must match package.json
	// const runnerDisposable = vscode.commands.registerCommand('condor.run', run);
	// const debuggerDisposable = vscode.commands.registerCommand('condor.debug', debug);

	// Extension making sure workspace storage folder is created
	// Ensure the directory exists (you may need to create it)
	const globalStoragePath = context.globalStorageUri.fsPath;
	if (!fs.existsSync(globalStoragePath)) {
		const dirCreated = fs.mkdirSync(globalStoragePath, { recursive: true });
		if (dirCreated) {
			console.log('created global storage directory:', globalStoragePath);
		} else {
			vscode.window.showErrorMessage('Failed to create global storage directory');
		}
	}

	const debugProvider = vscode.debug.registerDebugConfigurationProvider('txt-debug', new TxtDebugConfigurationProvider());
	const debugAdapterFactory = vscode.debug.registerDebugAdapterDescriptorFactory('txt-debug', new InlineDebugAdapterFactory(globalStoragePath));

	// context.subscriptions.push(runnerDisposable);
	// context.subscriptions.push(debuggerDisposable);
	context.subscriptions.push(debugProvider);
	context.subscriptions.push(debugAdapterFactory);

	// const customEditorProvider = vscode.window.registerCustomEditorProvider('condor.editor', new CondorTextEditorProvider(context));
	// context.subscriptions.push(customEditorProvider);
}

//
// cleanup after condor gets deactivated
//
export function deactivate() {}