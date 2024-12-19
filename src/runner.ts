import * as vscode from 'vscode';
import * as childprocess from 'child_process';
import { promisify } from 'util';
import { setupExecutable } from './common';

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
        vscode.window.showInformationMessage('No active editor');
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

//
// Cleanup intermediate assets
//
async function cleanup(file: vscode.Uri) {
    // TODO: Sleep before deleting file
    await sleep(2000);
    await vscode.workspace.fs.delete(file);
}

//
// sleep call
//
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/*const edit = new vscode.WorkspaceEdit();
const fullRange = new vscode.Range(
document.positionAt(0),
document.positionAt(text.length)
);

edit.replace(document.uri, fullRange, text.toUpperCase());
vscode.workspace.applyEdit(edit);*/