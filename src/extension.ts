import * as vscode from 'vscode';
import * as path from 'path';

//
// activate() is entry point for condor
//
export function activate(context: vscode.ExtensionContext) {
	console.log('condor running');
	
	// condor.test; must match package.json
	const disposable = vscode.commands.registerCommand('condor.test', async () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const document = editor.document;
			const text = document.getText();
			
			const edit = new vscode.WorkspaceEdit();
			const fullRange = new vscode.Range(
				document.positionAt(0),
				document.positionAt(text.length)
			);
			
			edit.replace(document.uri, fullRange, text.toUpperCase());
			vscode.workspace.applyEdit(edit);
			
			vscode.window.showInformationMessage('Testing condor: ' + text);
			
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

				if (codeFile) {
					// execute file
					execute(codeFile);

					// TODO: here we are sleeping because file will get removed before it's executed by terminal
					await sleep(2000);

					await vscode.workspace.fs.delete(codeFile);
				} else {
					vscode.window.showErrorMessage('Failed to generate intermediate code file');
				}
			} else {
				vscode.window.showErrorMessage('No models available');
			}
		} else {
			vscode.window.showInformationMessage('No active editor');
		}
	});
	
	context.subscriptions.push(disposable);
}

//
// cleanup after condor gets deactivated
//
export function deactivate() {}

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

//
// Execute code
//
function execute(codePath: vscode.Uri) {
	const terminal = vscode.window.createTerminal('Python Temp Script');

	terminal.sendText(`python ${codePath.fsPath}`, true);
	terminal.show();
}

//
// sleep call
//
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}