import * as vscode from 'vscode';

export class CondorTextEditorProvider implements vscode.CustomTextEditorProvider {
    constructor(private readonly context: vscode.ExtensionContext) {}
    
    public async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void> {
        // Set the HTML content of the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        
        webviewPanel.webview.html = this.getWebviewContent(webviewPanel.webview, document);
        
        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'edit':
                this.updateDocument(document, message.text);
                return;
            }
        });
        
        // Update the webview whenever the document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                webviewPanel.webview.postMessage({ type: 'update', text: document.getText() });
            }
        });
        
        // Dispose the subscription when the webview is closed
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }
    
    private getWebviewContent(webview: vscode.Webview, document: vscode.TextDocument): string {
        const text = document.getText();
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css'));
        
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet"/>
                <title>Custom Editor</title>
            </head>
            <body>
            <div id="editor">${text}</div>
            <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }
    
    // Updates the view when edits happen
    private updateDocument(document: vscode.TextDocument, text: string): void {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        edit.replace(document.uri, fullRange, text);
        vscode.workspace.applyEdit(edit);
    }
    
    // Wraps paragraphs with lines
    private formatContentWithLines(content: string): string {
        const lines = content.split('\n');
        console.log("Formatting lines");
        return lines.map(line => {
            const trimmedLine = line.trim();
            const paragraphClass = trimmedLine ? 'paragraph-container' : '';
            return `
            <div class="${paragraphClass}">
                <p class="content" contenteditable="true">${line}</p>
            </div>
            `;
        }).join('');
    }
}