import * as vscode from 'vscode';
import { setupExecutable } from './common';

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
                const document = await vscode.workspace.openTextDocument(executable);
                await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside); 
                
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
