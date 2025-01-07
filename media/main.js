// Script to handle custom editor interaction
(function() {
    const vscode = acquireVsCodeApi();

    // const editor = document.getElementById('editor');

    // // Send message to extension when the text changes
    // editor.addEventListener('input', () => {
    //     vscode.postMessage({
    //         command: 'edit',
    //         text: editor.value
    //     });
    // });

    // // Handle messages from the extension
    // window.addEventListener('message', event => {
    //     const message = event.data;
    //     switch (message.type) {
    //         case 'update':
    //             editor.value = message.text;
    //             break;
    //     }
    // });
    
    // Function to format the content as paragraphs with a line on the left if not empty
    function formatContentWithLines(content) {
        const lines = content.split('\\n');
        return lines.map(line => {
            const trimmedLine = line.trim();
            console.log("Trimmed line is ", trimmedLine);
            const paragraphClass = trimmedLine ? 'paragraph-container' : '';
            return `
                <div class="content ${paragraphClass}">
                    <p class="content" contenteditable="true">${trimmedLine}</p>
                </div>
            `;
        }).join('');
    }
    
    // Detect content changes and update the paragraphs dynamically
    document.getElementById('editor').addEventListener('input', () => {
        const editor = document.getElementById('editor');
        const text = Array.from(document.querySelectorAll('.content'))
        .map(p => p.innerText)
        .join('\\n');
        
        // Update the content with new paragraphs and lines
        editor.innerHTML = formatContentWithLines(text);
        
        // Send updated content to VS Code
        vscode.postMessage({ type: 'edit', text: text });
    });
})();