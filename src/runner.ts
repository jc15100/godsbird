import * as vscode from 'vscode';
import * as childprocess from 'child_process';
import { promisify } from 'util';
import { setupExecutable, cleanup } from './common';

///
/// condor.run functionality
///
export async function run() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const document = editor.document;
        const text = document.getText();
        
        let executable = await setupExecutable(text);

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

/*const edit = new vscode.WorkspaceEdit();
const fullRange = new vscode.Range(
document.positionAt(0),
document.positionAt(text.length)
);

edit.replace(document.uri, fullRange, text.toUpperCase());
vscode.workspace.applyEdit(edit);*/