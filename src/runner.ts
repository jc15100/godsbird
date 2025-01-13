import * as vscode from 'vscode';
import * as childprocess from 'child_process';
import { promisify } from 'util';
import { setupExecutable, cleanup, parseWorkspace } from './common';

///
/// condor.run functionality
///
export async function run() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const document = editor.document;
        const activeText = document.getText();

        parseWorkspace(document.uri);
        
        let executable = await setupExecutable(activeText);

        if (executable) {
            let output = await execute(executable);
            
            if (output) {
                showOutput(output);
            }
            
            // cleanup
            await cleanup(executable);
        } else {
            vscode.window.showErrorMessage('Failed to create executable');
        }
    } else {
        vscode.window.showInformationMessage('No active editor available');
    }
}

//
// Execute code
//
async function execute(codePath: vscode.Uri) {
    const command = `python ${codePath.fsPath}`;
    const exec = promisify(childprocess.exec);
    let result = await exec(command);
    
    if (result.stderr) {
        vscode.window.showErrorMessage(`Error executing ${result.stderr}`);
        return;
    }
    console.log(result.stdout);
    return result.stdout;
}

//
// Shows the output in the Output tab of VSCode 
//
function showOutput(output: string) {
    const outputChannel = vscode.window.createOutputChannel('condor output');
    outputChannel.appendLine(output);
    outputChannel.show();
}