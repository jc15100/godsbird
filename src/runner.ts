import * as vscode from 'vscode';

import { setupExecutable, cleanup, setupExecutionContext, execute } from './common';

///
/// condor.run functionality
///
export async function run() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const document = editor.document;
        const activeText = document.getText();
        
         // (prompt => code)
        const context = await setupExecutionContext(document.uri);
        
        const executableText = context + "\n" + activeText;
        
        let executable = await setupExecutable(executableText);

        if (executable) {
            let output = await execute(executable);
            
            if (output) {
                showOutput(output);
            }
            
            // cleanup
            await cleanup(executable);
        } else {
            vscode.window.showErrorMessage('condor: Failed to create executable');
        }
    } else {
        vscode.window.showInformationMessage('condor: No active editor available');
    }
}

//
// Shows the output in the Output tab of VSCode 
//
function showOutput(output: string) {
    const outputChannel = vscode.window.createOutputChannel('condor output');
    outputChannel.appendLine(output);
    outputChannel.show();
}