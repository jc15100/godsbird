import * as vscode from 'vscode';
import { setupExecutable, cleanup } from './common';

///
/// condor.debug functionality
///
export async function debug() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const document = editor.document;
        const text = document.getText();
        
        const executable = await setupExecutable(text);
        
        if (executable) {
            try {
                // show generated code in split view
                const document = await vscode.workspace.openTextDocument(executable);
                await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside); 

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
                    vscode.window.showInformationMessage('Debugging started!');
                } else {
                    vscode.window.showErrorMessage('Failed to start debugging.');
                }

                // cleanup
                await cleanup(executable);
            } catch (error) {
                vscode.window.showErrorMessage("Failed to show code in split window");
            }
        } else {
            vscode.window.showErrorMessage('Failed to create executable');
        }
    } else {
        vscode.window.showInformationMessage("No active editor available");
    }
}
