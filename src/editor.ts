import * as vscode from 'vscode';
import * as fs from 'fs';

export class CondorTextEditorProvider implements vscode.CustomTextEditorProvider {
    constructor(private readonly context: vscode.ExtensionContext) {}

    private lastCursorPos = { nodeText: '', offset: 0 };

    public async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void> {
        // Set the HTML content of the webview
        const webview = webviewPanel.webview;
        
        webview.options = {
            enableScripts: true,
        };
        
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
                    this.updateDocument(document, message.text);
                    return;
                case 'cursorUpdate':
                    this.lastCursorPos = { nodeText: message.nodeText, offset: message.offset };
                    return;
            }
        });
        
        // Dispose the subscription when the webview is closed
        webviewPanel.onDidDispose(() => {
            documentChangeSubscription.dispose();
        });
    }
    
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
    }
    
    // Updates the VSCode document when edits happen in the webview
    private updateDocument(document: vscode.TextDocument, text: string): void {
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
    }
}