import * as vscode from 'vscode';
import * as path from 'path';

export async function setupExecutable(text: string) {
    // get a model and execute user prompt file
    const modelInput = prepareModelInput(text);
    const [model] = await vscode.lm.selectChatModels({
        vendor: 'copilot', family: 'gpt-4o'
    });
    
    if (model) {
        let modelResponse = await model.sendRequest([modelInput], {}, new vscode.CancellationTokenSource().token);
        let response = await parseModelOutput(modelResponse);
        
        console.log("generated code " + response);
        let codeFile = await createExecutable(response);
        return codeFile;
    } else {
        console.log("Failed to load a model");
        return null;
    }
}

//
// Prepares input to LLM to generate code for user text
//
function prepareModelInput(text: String): vscode.LanguageModelChatMessage {
    let modelInput = vscode.LanguageModelChatMessage.User("Return just the Python code as plain text, no python prefix," +
        "no explanation and no string characters decoration, for the following request: " + text);
        return modelInput;
    }
    
    //
    // Processes LLM output and returns executable code
    //
    async function parseModelOutput(chatResponse: vscode.LanguageModelChatResponse) {
        let accumulatedResponse = '';
        
        for await (const fragment of chatResponse.text) {
            accumulatedResponse += fragment;
        }
        
        return accumulatedResponse;
    }
    
    //
    // Store code to file
    //
    async function createExecutable(code: string) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Folders not found to save temporary file.');
            return null;
        }
        
        // Define the path for the temporary Python file
        const tempFilePath = workspaceFolder.with({ path: path.join(workspaceFolder.path, 'tempScript.py') });
        
        // Convert Python code to a Buffer for writing
        const encoder = new TextEncoder();
        const data = encoder.encode(code);
        
        try {
            // Write the file using vscode.workspace.fs
            await vscode.workspace.fs.writeFile(tempFilePath, data);
            
            console.log(`temporary Python file at ${tempFilePath.path}`);
            return tempFilePath;
        } catch (error) {
            vscode.window.showErrorMessage('Error creating temporary code file.');
        }
    }