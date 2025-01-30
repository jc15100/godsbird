import * as vscode from 'vscode';
import { setupExecutable, cleanup, setupExecutionContext } from './common';
import { CondorDebugSession } from './debugAdapter';

///
/// condor.debug functionality
///
export async function debug() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const document = editor.document;
        const activeText = document.getText();
        
        // (prompt => code)
        const context = await setupExecutionContext(document.uri.fsPath);
        
        const executableText = context + "\n" + activeText;
        
        let executable = await setupExecutable(executableText);
        
        if (executable) {
            try {
                // show generated code in split view
                const generatedCode = await vscode.workspace.openTextDocument(executable);
                await vscode.window.showTextDocument(generatedCode, vscode.ViewColumn.Beside); 
                
                // start debugging session in generated code
                const debugConfiguration: vscode.DebugConfiguration = {
                    type: 'python',                 // Debugger type (Python)
                    request: 'launch',              // Request to launch a new debug session
                    name: 'Launch Python Program',  // Name of the configuration shown in VS Code UI
                    program: executable.path, // Path to the Python file to debug
                    stopOnEntry: true              // Optionally stop on the first line
                };
                
                const success = await vscode.debug.startDebugging(
                    vscode.workspace.workspaceFolders?.[0], // The workspace folder to debug in
                    debugConfiguration                       // The configuration for debugging
                );
                
                if (success) {
                    vscode.window.showInformationMessage('condor: Debugging started!');
                } else {
                    vscode.window.showErrorMessage('condor: Failed to start debugging.');
                }
                
                // track changes made to the temporary generated code; regenerate the prompt (code => prompt)
                vscode.workspace.onDidChangeTextDocument((event) => {
                    if (generatedCode.uri === event.document.uri) {
                        event.contentChanges.forEach(change => {
                            console.log('Edit made:', change);
                            console.log('Range:', change.range); // The range of the edited text
                            console.log('Text inserted or replaced:', change.text); // The new text inserted
                            console.log('Range length:', change.rangeLength); // Length of the range that was replaced (if applicable)
                        });
                    }
                });
                
                // cleanup
                await cleanup(executable);
            } catch (error) {
                vscode.window.showErrorMessage("condor: Failed to show code in split window");
            }
        } else {
            vscode.window.showErrorMessage('condor: Failed to create executable');
        }
    } else {
        vscode.window.showInformationMessage("condor: No active editor available");
    }
}

export class TxtDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    
    resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.DebugConfiguration | undefined {
        // if launch.json is missing or empty
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'plaintext') {
                config.type = 'txt-debug';
                config.name = 'Launch';
                config.request = 'launch';
                config.program = '${file}';
                config.stopOnEntry = true;
                config.trace = "verbose";
            }
        }
        
        if (!config.program) {
            vscode.window.showInformationMessage("Cannot find a program to debug");
            return undefined;
        }
        
        return config;
    }
    
    resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined, debugConfiguration: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
        return debugConfiguration;
    }
}

export class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

    createDebugAdapterDescriptor(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterInlineImplementation(new CondorDebugSession(workspaceFileAccessor));
    }
}

export interface FileAccessor {
	isWindows: boolean;
	readFile(path: string): Promise<Uint8Array>;
	writeFile(path: string, contents: Uint8Array): Promise<void>;
}

export const workspaceFileAccessor: FileAccessor = {
	isWindows: typeof process !== 'undefined' && process.platform === 'win32',
	async readFile(path: string): Promise<Uint8Array> {
		let uri: vscode.Uri;
		try {
			uri = pathToUri(path);
		} catch (e) {
			return new TextEncoder().encode(`cannot read '${path}'`);
		}

		return await vscode.workspace.fs.readFile(uri);
	},
	async writeFile(path: string, contents: Uint8Array) {
		await vscode.workspace.fs.writeFile(pathToUri(path), contents);
	}
};

function pathToUri(path: string) {
	try {
		return vscode.Uri.file(path);
	} catch (e) {
		return vscode.Uri.parse(path);
	}
}
