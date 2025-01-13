import * as vscode from 'vscode';
import { setupExecutable, cleanup, setupExecutionContext } from './common';

///
/// condor.debug functionality
///
export async function debug() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const document = editor.document;
        const activeText = document.getText();
        
        // (prompt => code)
        const context = await setupExecutionContext(document.uri);
                
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
