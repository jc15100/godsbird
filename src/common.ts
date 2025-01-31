import * as vscode from 'vscode';
import * as path from 'path';
import { promisify } from 'util';
import * as childprocess from 'child_process';
import * as fs from 'fs';

let modelLoaded: vscode.LanguageModelChat | null = null;

//
// Setup model for code generation
//
export async function setupModel(): Promise<vscode.LanguageModelChat | null> {
    // get a model
    if (modelLoaded) {
        console.log("Model already loaded, returning it.");
        return modelLoaded;
    }

    const [model] = await vscode.lm.selectChatModels({
        vendor: 'copilot', family: 'gpt-4o'
    });
    
    if (model) {
        modelLoaded = model;
        return model;
    } else {
        console.log("Failed to load a model");
        return null;
    }
}

export async function generateCode(text: string) {
    // get a model and execute user prompt file
    const modelInput = prepareCodeGenerationInput(text);
    const model = await setupModel();
    
    if (model) {
        let modelResponse = await model.sendRequest([modelInput], {}, new vscode.CancellationTokenSource().token);
        let response = await parseModelResponse(modelResponse);
        
        console.log("generated code: \n" + response);
        return response;
    } else {
        console.log("Failed to generate code");
        return null;
    }
}

//
// Setup code executable from raw text prompt
//
export async function setupExecutable(text: string) {
    const code = await generateCode(text);

    if (code) {
        let codeFile = await createExecutable(code);
        console.log("Executable setup complete at", codeFile?.path);
        return codeFile;
    } else {
        console.log("Failed to setup executable");
        return null;
    }
}

//
// Prepares input to LLM to generate code for user text
//
function prepareCodeGenerationInput(text: String): vscode.LanguageModelChatMessage {
    let modelInput = vscode.LanguageModelChatMessage.User("Return just the Python code as plain text, no python prefix," +
        "no explanation and no string characters decoration, for the following request: " + text);
    return modelInput;
}
    
//
// Processes LLM output and returns executable code
//
async function parseModelResponse(chatResponse: vscode.LanguageModelChatResponse) {
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
    const tempFilePath = workspaceFolder.with({ path: path.join(workspaceFolder.path, 'condor-temp-generated.py') });
        
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
// Parse the workspace .txt files and combine prompts/instructions into a common execution context
// Allows for "import/reusable" code snippets
//
export async function setupExecutionContext(filePath: string) {
    const directory = path.dirname(filePath);
    let files = await vscode.workspace.findFiles(new vscode.RelativePattern(directory, '**/*.txt'));

    // remove current file from list
    files = files.filter(file => file.path !== filePath);

    let executionContext = '';

    console.log("Setting up execution context");
    
    // iterate through all text files in the workspace
    for (const file of files) {
        const doc = await vscode.workspace.openTextDocument(file);
        const text = doc.getText();
            
        let isPrompt = await isPromptFile(text);
        // consider only those files that are prompt
        if (isPrompt) {
            console.log("\tPrompt file: ", file.path);
            // add text to execution context
            executionContext += text + '\n';
        }
    }

    return executionContext;
}

//
// Execute code
//
export async function execute(codePath: vscode.Uri) {
    const command = `python ${codePath.fsPath}`;
    const exec = promisify(childprocess.exec);
    let result = await exec(command);
    
    if (result.stderr) {
        vscode.window.showErrorMessage(`condor: Error executing ${result.stderr}`);
        return;
    }
    console.log(result.stdout);
    return result.stdout;
}

export async function debugCode(code: string) {
    // add breakpoint at the end of the code to get stack trace
    const finalCode = `\nimport pdb\n${code}\npdb.set_trace()`;
    const codePath = await createExecutable(finalCode);
    
    try {
        // Spawn the Python debugger (pdb) process
        const pythonProcess = childprocess.spawn('python', ['-m', 'pdb', '-c', 'continue', '-c', 'q', codePath?.path]);

        // Capture stdout and stderr
        pythonProcess.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });

        pythonProcess.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        pythonProcess.on('close', (code) => {
            console.log(`Python process exited with code ${code}`);
            // Clean up the temp file after execution
            // fs.unlinkSync(codePath);
        });

        setTimeout(() => {
            pythonProcess.stdin.write('p locals()\n');  // Print local variables
          }, 500);
    } catch (error) {
        throw new Error(`Execution Error: ${error.message}`);
    }
}

export async function executeCode(code: string): Promise<string> {
    const command = `python -c "${code}"`;
    const exec = promisify(childprocess.exec);
    try {
        // Await the result of exec
        const { stdout, stderr } = await exec(command);
    
        if (stderr) {
          throw new Error(`Python Error: ${stderr}`);
        }
    
        return stdout;
      } catch (error) {
        throw new Error(`Execution Error: ${error.message}`);
      }
}
    
//
// Check if a file is a prompt file, code.
//
async function isPromptFile(text: string) {
    const model = await setupModel();
    const modelInput = prepareIsPromptFileCheckInput(text);
        
    if (model) {
        let modelResponse = await model.sendRequest([modelInput], {}, new vscode.CancellationTokenSource().token);
        let response = await parseModelResponse(modelResponse);
        console.log("\tisPromptFile response: ", response);

        // parse the boolean from response
        if (response.trim().toLowerCase() === 'true') {
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
}
    
//
// Create a prompt file to check with the LLM whether the file contents are prompts worth considering.
//
function prepareIsPromptFileCheckInput(text: String): vscode.LanguageModelChatMessage {
    // use only the first 100 characters of the text
    let textInput = text.substring(0, 100);

    let modelInput = vscode.LanguageModelChatMessage.User("Return only a boolean True or False, nothing else, about whether the text shown below is a prompt or part of a prompt:" + textInput);
    return modelInput;
}
    
//
// Cleanup intermediate assets
//
export async function cleanup(file: vscode.Uri) {
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