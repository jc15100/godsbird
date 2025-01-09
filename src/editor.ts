import * as vscode from 'vscode';
import * as fs from 'fs';

export class CondorTextEditorProvider implements vscode.CustomTextEditorProvider {
    constructor(private readonly context: vscode.ExtensionContext) {}
    
    private lastCursorPos = { nodeText: '', offset: 0 };
    
    public async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void> {
        const webview = webviewPanel.webview;
        
        webview.options = {
            enableScripts: true,
        };
        
        // Get HTMl setup for the webview
        webview.html = this.getHtmlForWebview(webview);
        
        // Initial update of the webview with document content
        this.updateWebview(webview, document);
        
        // Listen to document changes and update the webview accordingly
        const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                this.updateWebview(webview, e.document);
            }
        });
        
        // Handle messages from the webview
        webview.onDidReceiveMessage(message => {
            switch (message.type) {
                case 'edit':
                this.updateDocument(message.text, document);
                return;
                case 'cursorUpdate':
                this.lastCursorPos = { nodeText: message.nodeText, offset: message.offset };
                return;
                case 'saveHtmlContent':
                this.saveHtlmContent(message.content, document);
                return;
            }
        });
        
        // Dispose the subscription when the webview is closed
        webviewPanel.onDidDispose(() => {
            documentChangeSubscription.dispose();
        });
    }
    
    // Load the html, css, and js files for the webview
    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css'));
        const htmlPath = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.html'));
        let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');
        
        // Replace any resource URLs with the proper webview URIs
        htmlContent = htmlContent.replace(/\${scriptUri}/g, scriptUri.toString());
        htmlContent = htmlContent.replace(/\${styleUri}/g, styleUri.toString());
        
        return htmlContent;
    }
    
    // Updates the webview with the content of the document
    private updateWebview(webview: vscode.Webview, document: vscode.TextDocument): void {
        const content = document.getText();
        
        webview.postMessage({ 
            type: 'setContent', 
            text: content, 
            nodeText: this.lastCursorPos.nodeText,
            offset: this.lastCursorPos.offset 
        });
        
        document.save().then((success) => {
            if (success) {
                console.log("Doc saved successfully.");
            } else {
                console.log("Save failed.");
            }
        });
    }
    
    // Updates the VSCode document when edits happen in the webview
    private updateDocument(text: string, document: vscode.TextDocument): void {
        const editor = vscode.window.activeTextEditor;
        
        if (document){
            // const document = editor.document;
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
            );
            edit.replace(document.uri, fullRange, text);
            vscode.workspace.applyEdit(edit).then(success => {
                if (success) {
                    console.log("Edit applied successfully.");
                } else {
                    console.log("Edit failed.");
                }
            });
        } else {
            console.log("No active editor found.");
        } 
    }
    
    private saveHtlmContent(content: string, document: vscode.TextDocument): void {
        if (document) {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(0, 0, document.lineCount, 0);
            edit.replace(document.uri, fullRange, content);

            vscode.workspace.applyEdit(edit).then(success => {
                if (success) {
                    console.log("HTML edit applied successfully.");
                } else {
                    console.log("HTML edit failed.");
                }
            });
        } 
    }
}