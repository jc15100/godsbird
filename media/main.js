const contentDiv = document.getElementById('content');
const vscode = acquireVsCodeApi();

// handle messages to the webview
window.addEventListener('message', event => {
    const message = event.data;
    console.log("Message received is ", event.data);
    
    if (message.type === 'setContent') {
        const content = message.text;
        formatView(content);
    } 
});

// handle user input & communicate to the VSCode document
contentDiv.addEventListener('input', () => {    
    const content = document.getElementById('content');
    vscode.postMessage({ type: 'edit', text: content.textContent });
});

contentDiv.addEventListener('mouseup', () => {    
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const startNode = range.startContainer;
    const startOffset = range.startOffset;
    
    /*console.log("(mouseup) range is ", range);
    console.log("(mouseup) startNode is ", startNode);
    console.log("(mouseup) startOffset is ", startOffset);*/
    
    // communicate the cursor position to the VSCode document
    vscode.postMessage({
        type: 'cursorUpdate',
        nodeText: startNode.textContent, // Store reference to the node text
        offset: startOffset              // Store offset within the text node
    });
});

// restores the position of the cursor
function restoreCursorPosition(nodeText, offset) {
    if (contentDiv) {
        const textNode = contentDiv.firstChild.firstChild;
        console.log("textNode type is ", textNode.nodeType);
        if (textNode) {
            console.log("Restoring cursor position to ", nodeText, offset);
            const range = document.createRange();
            range.setStart(textNode, 0);
            range.setEnd(textNode, offset);
            
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }
}

function formatView(content) {
    console.log("Current content is \n", contentDiv.innerHTML);
    const divs = document.querySelectorAll('div');
    
    // Iterate through each div and check if it contains text
    divs.forEach(div => {
        // Check if the div contains any text (non-empty)
        const hasText = Array.from(div.childNodes).some(node => {
            // Check if the node is not a <br> and it has text content (not just whitespace)
            return node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0 ||
                   node.nodeType === Node.ELEMENT_NODE && node.nodeName !== 'BR';
        });

        if (hasText) {
            // Add the class 'has-text' to non-empty divs
            div.classList.add('has-text');
        } else {
            div.classList.remove('has-text');
        }
    });
}
