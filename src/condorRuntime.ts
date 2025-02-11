import { EventEmitter } from 'events';
import { setupExecutionContext, generateCode, createExecutable } from './common';
import * as fs from 'fs';
import { spawn } from 'child_process';

// A class that maps to a file specified by the user with the raw text
export class SourceCode {
	private filepath: string = '';
	private sourceLines: string[] = [];
	private currentLine = 0;
	
	constructor(filepath: string) {
		this.filepath = filepath;
		this.sourceLines = fs.readFileSync(this.filepath, 'utf-8').split(/\r?\n/);
	}
	
	public getLine(line: number): string {
		return this.sourceLines[line === undefined ? this.currentLine : line].trim();
	}
	
	public getCode() {
		return this.sourceLines.join('\n');
	}
	
	public getLength() {
		return this.sourceLines.length;
	}
}

export interface FileAccessor {
	isWindows: boolean;
	readFile(path: string): Promise<Uint8Array>;
	writeFile(path: string, contents: Uint8Array): Promise<void>;
}

export interface IRuntimeBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

interface IRuntimeStepInTargets {
	id: number;
	label: string;
}

interface IRuntimeStackFrame {
	index: number;
	name: string;
	file: string;
	line: number;
	column?: number;
	instruction?: number;
}

interface IRuntimeStack {
	count: number;
	frames: IRuntimeStackFrame[];
}

interface RuntimeDisassembledInstruction {
	address: number;
	instruction: string;
	line?: number;
}

export type IRuntimeVariableType = number | boolean | string | RuntimeVariable[];

export class RuntimeVariable {
	public name?: string;
	public value?: IRuntimeVariableType;
	public reference?: number;
	
	constructor(name: string, value: IRuntimeVariableType) {
		this.name = name;
		this.value = value;
	}
}

interface Word {
	name: string;
	line: number;
	index: number;
}

export function timeout(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
* Condor runtime debugger: runs through text file, generates code for each line and executes underlying code.
*  The (local & global) variables and methods from generated code are shown in the debug UI.
*/
export class CondorRuntime extends EventEmitter {
	
	// the initial (and one and only) file we are 'debugging'
	private _sourceFile: string = '';
	public get sourceFile() {
		return this._sourceFile;
	}
	
	private variables = new Map<string, RuntimeVariable>();	
	
	// This is the next line that will be 'executed'
	private _currentLine = 0;
	private get currentLine() {
		return this._currentLine;
	}
	private set currentLine(x) {
		this._currentLine = x;
	}
	private currentColumn: number | undefined;
	
	// This is the next instruction that will be 'executed'
	public instruction= 0;
	
	// maps from sourceFile to array of IRuntimeBreakpoint
	private breakPoints = new Map<string, IRuntimeBreakpoint[]>();
	
	// all instruction breakpoint addresses
	private instructionBreakpoints = new Set<number>();
	
	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private breakpointId = 1;
	
	private breakAddresses = new Map<string, string>();
	
	private _sourceCode: SourceCode | undefined = undefined;
	
	private _context: string | undefined = undefined;
	
	private _pythonProcess: any | undefined = undefined;
	
	private _codeHistory: string[] = [];

	private _storagePath: string;
	
	constructor(private fileAccessor: FileAccessor, storagePath: string) {
		super();
		this._storagePath = storagePath;
	}
	
	/**
	* Start executing the given program.
	*/
	public async start(program: string, stopOnEntry: boolean, debug: boolean): Promise<void> {
		
		await this.loadSource(this.normalizePathAndCasing(program));
		
		if (debug) {
			await this.verifyBreakpoints(this._sourceFile);
			
			if (stopOnEntry) {
				this.findNextStatement(false, 'stopOnEntry');
			} else {
				// we just start to run until we hit a breakpoint, an exception, or the end of the program
				await this.continue(false);
			}
		} else {
			await this.continue(false);
		}
	}
	
	/**
	* Continue execution to the end/beginning.
	*/
	public async continue(reverse: boolean) {
		// find the next statement to stop at
		var endReached = false;
		while (true) {
			this.executeLine(this.currentLine);
			if (this.updateCurrentLine(reverse)) {
				endReached = true;
				break;
			}
			if (this.findNextStatement(reverse)) {
				break;
			}
		}

		// once we find the line we need to stop at, execute code.
		await this.executeCode();

		// disconnect & end the debugging session
		if (endReached) {
			this.sendEvent('end');
		}
	}
	
	/**
	* Step to the next/previous non empty line.
	*/
	public async step(instruction: boolean, reverse: boolean) {
		var endReached = false;

		if (instruction) {
			if (reverse) {
				this.instruction--;
			} else {
				this.instruction++;
			}
			this.sendEvent('stopOnStep');
		} else {
			this.executeLine(this.currentLine);
			
			endReached = this.updateCurrentLine(reverse);
			if (!endReached) {
				this.findNextStatement(reverse, 'stopOnStep');
			}
		}

		await this.executeCode();

		if (endReached) {
			this.sendEvent('end');
		}
	}
	
	private updateCurrentLine(reverse: boolean): boolean {
		if (reverse) {
			if (this.currentLine > 0) {
				this.currentLine--;
			} else {
				// no more lines: stop at first line
				this.currentLine = 0;
				this.currentColumn = undefined;
				this.sendEvent('stopOnEntry');
				return true;
			}
		} else {
			if (this._sourceCode && this.currentLine < this._sourceCode?.getLength()-1) {
				this.currentLine++;
			} else {
				// no more lines: run to end (triggers an 'end' event)
				this.currentColumn = undefined;
				return true;
			}
		}
		return false;
	}
	
	/**
	* "Step into" for Mock debug means: go to next character
	*/
	public stepIn(targetId: number | undefined) {
		if (typeof targetId === 'number') {
			this.currentColumn = targetId;
			this.sendEvent('stopOnStep');
		} else {
			if (typeof this.currentColumn === 'number') {
				if (this._sourceCode && this.currentColumn <= this._sourceCode?.getLine(this.currentLine).length) {
					this.currentColumn += 1;
				}
			} else {
				this.currentColumn = 1;
			}
			this.sendEvent('stopOnStep');
		}
	}
	
	/**
	* "Step out" for Mock debug means: go to previous character
	*/
	public stepOut() {
		if (typeof this.currentColumn === 'number') {
			this.currentColumn -= 1;
			if (this.currentColumn === 0) {
				this.currentColumn = undefined;
			}
		}
		this.sendEvent('stopOnStep');
	}
	
	public getStepInTargets(frameId: number): IRuntimeStepInTargets[] {
		
		const line = this.getLine();
		const words = this.getWords(this.currentLine, line);
		
		// return nothing if frameId is out of range
		if (frameId < 0 || frameId >= words.length) {
			return [];
		}
		
		const { name, index  }  = words[frameId];
		
		// make every character of the frame a potential "step in" target
		return name.split('').map((c, ix) => {
			return {
				id: index + ix,
				label: `target: ${c}`
			};
		});
	}
	
	/**
	* Stack trace are the lines of raw text that were executed so far.
	*/
	public stack(startFrame: number, endFrame: number): IRuntimeStack {
		
		const frames: IRuntimeStackFrame[] = [];

		for (let i = startFrame; i < Math.min(endFrame, this._codeHistory.length); i++) {
			
			const stackFrame: IRuntimeStackFrame = {
				index: i,
				name: `${this._codeHistory[i]}(${i})`,
				file: this._sourceFile,
				line: this.currentLine,
				column: 0, // words[i].index
				instruction: 0
			};
			
			frames.push(stackFrame);
		}
		
		return {
			frames: frames,
			count: this._codeHistory.length
		};
	}
	
	/*
	* Set breakpoint in file with given line.
	*/
	public async setBreakPoint(path: string, line: number): Promise<IRuntimeBreakpoint> {
		path = this.normalizePathAndCasing(path);
		
		const bp: IRuntimeBreakpoint = { verified: false, line, id: this.breakpointId++ };
		let bps = this.breakPoints.get(path);
		if (!bps) {
			bps = new Array<IRuntimeBreakpoint>();
			this.breakPoints.set(path, bps);
		}
		bps.push(bp);
		
		await this.verifyBreakpoints(path);
		
		return bp;
	}
	
	/*
	* Clear breakpoint in file with given line.
	*/
	public clearBreakPoint(path: string, line: number): IRuntimeBreakpoint | undefined {
		const bps = this.breakPoints.get(this.normalizePathAndCasing(path));
		if (bps) {
			const index = bps.findIndex(bp => bp.line === line);
			if (index >= 0) {
				const bp = bps[index];
				bps.splice(index, 1);
				return bp;
			}
		}
		return undefined;
	}
	
	public clearBreakpoints(path: string): void {
		this.breakPoints.delete(this.normalizePathAndCasing(path));
	}
	
	public setDataBreakpoint(address: string, accessType: 'read' | 'write' | 'readWrite'): boolean {
		
		const x = accessType === 'readWrite' ? 'read write' : accessType;
		
		const t = this.breakAddresses.get(address);
		if (t) {
			if (t !== x) {
				this.breakAddresses.set(address, 'read write');
			}
		} else {
			this.breakAddresses.set(address, x);
		}
		return true;
	}
	
	public clearAllDataBreakpoints(): void {
		this.breakAddresses.clear();
	}
	
	public setExceptionsFilters(namedException: string | undefined, otherExceptions: boolean): void {
		// todo
	}
	
	public setInstructionBreakpoint(address: number): boolean {
		this.instructionBreakpoints.add(address);
		return true;
	}
	
	public clearInstructionBreakpoints(): void {
		this.instructionBreakpoints.clear();
	}
	
	public async getGlobalVariables(): Promise<RuntimeVariable[]> {
		try {
			const variableString = await this.getVariables('globals()');
			const output = this.parsePythonOutput(variableString);
		
			// keep only variables
			const variables = Object.fromEntries(Object.entries(output).filter(this.filterHelper.bind(this)));
			return Array.from(Object.entries(variables), ([name, value]) => new RuntimeVariable(name, value));
		} catch(error){
			console.error("Error getting global variables "+ error);
			return [];
		}
	}
	
	public async getLocalVariables(): Promise<RuntimeVariable[]> {
		try {
			const variableString = await this.getVariables('locals()');
			const output = this.parsePythonOutput(variableString);
			
			// keep only variables
			const variables = Object.fromEntries(Object.entries(output).filter(this.filterHelper.bind(this)));
			return Array.from(Object.entries(variables), ([name, value]) => new RuntimeVariable(name, value));
		} catch(error){
			console.error("Error getting local variables "+ error);
			return [];
		}
	}

	public async getMethods(): Promise<RuntimeVariable[]> {
		try {
			const variableString = await this.getVariables('globals()');
			const output = this.parsePythonOutput(variableString);
		
			// keep only methods
			const methods = Object.fromEntries(Object.entries(output).filter(this.filterHelper.bind(this)));
			return Array.from(Object.entries(methods), ([name, value]) => new RuntimeVariable(name, value));
		} catch(error) {
			console.error("Error getting methods "+ error);
			return [];
		}
	}

	private filterHelper(entry: [string, any]): boolean {
		const [_, value] = entry;
		if (typeof value === 'string' || Array.isArray(value)) {
			return !value.includes("<function");
		} else {
			return true;
		}
	}
	
	public getLocalVariable(name: string): RuntimeVariable | undefined {
		// TODO: Call the methods above? 
		return this.variables.get(name);
	}
	
	/**
	* Implement
	*/
	public disassemble(address: number, instructionCount: number): RuntimeDisassembledInstruction[] {
		// TODO: implement
		return [];
	}
	
	// private methods
	
	private getLine(line?: number): string {
		return this._sourceCode?.getLine(line === undefined ? this.currentLine : line).trim() ?? '';
	}
	
	private getWords(l: number, line: string): Word[] {
		// break line into words
		const WORD_REGEXP = /[a-z]+/ig;
		const words: Word[] = [];
		let match: RegExpExecArray | null;
		while (match = WORD_REGEXP.exec(line)) {
			words.push({ name: match[0], line: l, index: match.index });
		}
		return words;
	}
	
	private async loadSource(file: string): Promise<void> {
		if (this._sourceFile !== file) {
			this._sourceFile = this.normalizePathAndCasing(file);
			await this.initializeContentWithPath(file);
		}
	}
	
	/**
	* Loads the raw text context from the source file specified.
	* Also setups context from any other file around it.
	* @param sourceFile 
	*/
	private async initializeContentWithPath(sourceFile: string) {
		this._sourceCode = new SourceCode(sourceFile);
		
		this._context = await setupExecutionContext(sourceFile);
	}
	
	/**
	* return true on stop
	*/
	private findNextStatement(reverse: boolean, stepEvent?: string): boolean {
		
		for (let ln = this.currentLine; reverse ? ln >= 0 : this._sourceCode && ln < this._sourceCode?.getLength(); reverse ? ln-- : ln++) {
			
			// is there a source breakpoint?
			const breakpoints = this.breakPoints.get(this._sourceFile);
			if (breakpoints) {
				const bps = breakpoints.filter(bp => bp.line === ln);
				if (bps.length > 0) {
					
					// send 'stopped' event
					this.sendEvent('stopOnBreakpoint');
					
					// the following shows the use of 'breakpoint' events to update properties of a breakpoint in the UI
					// if breakpoint is not yet verified, verify it now and send a 'breakpoint' update event
					if (!bps[0].verified) {
						bps[0].verified = true;
						this.sendEvent('breakpointValidated', bps[0]);
					}
					
					this.currentLine = ln;
					return true;
				}
			}
			
			const line = this.getLine(ln);
			if (line.length > 0) {
				this.currentLine = ln;
				break;
			}
		}
		if (stepEvent) {
			this.sendEvent(stepEvent);
			return true;
		}
		return false;
	}
	
	/**
	* "execute a line" of the text file.
	*/
	private executeLine(ln: number) {
		const currentCode = this.getLine(ln);
		
		if (currentCode.length !== 0) {
			this._codeHistory.push(currentCode);
		}
	}

	private async executeCode() {
		// setup execution context once if not set
		if (this._context === undefined) {
			this._context = await setupExecutionContext(this._sourceFile);
		}

		const executableText = this._context + "\n" + this._codeHistory.join('\n');
			
		const code = await generateCode(executableText);
		if (code) {
			await this.debugCode(code);
		}
	}
	
	//
	// Execute the generated Python code in the pdb debugger
	//
	private async debugCode(code: string) {
		// add breakpoint at the end of the code to get stack trace
		const finalCode = `\nimport pdb\n${code}\npdb.set_trace()`;
		const codePath = await createExecutable(finalCode, this._storagePath);
		
		try {
			// Spawn the Python debugger (pdb) process
			if (codePath) {
				this._pythonProcess = spawn('python', ['-m', 'pdb', '-c', 'continue', '-c', 'q', codePath?.path]);

				this._pythonProcess.stdout.on('data', (data: any) => {
					const output = data.toString();
					const cleanedOutput = output.replace(/^(--Return--|->|>|\(Pdb\)|\{).*$\n?/gm, '');

					// only send clean output & not debugger interim output
					if (!this.isDebuggerOutput(cleanedOutput) && cleanedOutput.length > 0) {
						this.sendEvent('output', 'out', cleanedOutput, this._sourceFile, this.currentLine, 0);
					}
				});
				
				this._pythonProcess.stderr.on('data', (data: any) => {
					const output = data.toString();
					const cleanedOutput = output.replace(/^(--Return--|->|>|\(Pdb\)|\{).*$\n?/gm, '');

					// only send clean output & not debugger interim output
					if (!this.isDebuggerOutput(cleanedOutput) && cleanedOutput.length > 0) {
						this.sendEvent('output', 'err', cleanedOutput, this._sourceFile, this.currentLine, 0);
					}
				});
			}
		} catch (error) {
			throw new Error(`Execution Error: ${error}`);
		}
	}
	//
	// Communicate with the Python debugger process and extract variables
	// Command can be locals() or globals()
	//
	private async getVariables(command: string): Promise<string> {
		const stderrPromise = new Promise<string>((resolve, reject) => {
			let localData = '';

			if (this._pythonProcess && this._pythonProcess.stdout) {
				this._pythonProcess.stdout.on('data', (data: any) => {
					// add only line that starts with { for locals output
					const dataString = data.toString();
					
					// check for variable output only (predefined command below)
					if (this.isVariablesOutput(dataString)) {
						const closingIndex = dataString.lastIndexOf('}');
						// omit \' at the beginning of the string
						localData += dataString.substring(1, closingIndex + 1);
						console.log("\tVariables identified:", localData);
						resolve(localData);
					}
				});
			} else {
				console.log("Subprocess has not stdout stream");
				resolve('');
			}
			
			this._pythonProcess.on('error', (err: any) => {
				// Reject the promise if an error occurs in the process
				console.log("Error in Python process:", err);
				// TODO: Reconsider whether to reject and catch error above.
				resolve('');
			});

			// print locals (already parsed to avoid noise)
			let finalCommand = `import json; json.dumps({k: v for k,v in ${command}.items() if \'__\' not in k and \'pdb\' not in k}, default=str)\n`;
			this._pythonProcess.stdin.write(finalCommand);

			// this._pythonProcess.stdin.end();
		});
		
		return stderrPromise;
	}
	
	private parsePythonOutput(output: string): Record<string, any> {
		try {
			if (output.length === 0) {
				console.log("No output from Python to parse.");
				return {};
			}

			// Step 1: Replace single quotes with double quotes to match JSON format
			let jsonString = output.replace(/'/g, '"');
			
			// Step 2: Convert None (Python) to null (JavaScript/JSON)
			jsonString = jsonString.replace(/\bNone\b/g, 'null');
			
			// Step 3: Convert True/False (Python) to true/false (JavaScript/JSON)
			jsonString = jsonString.replace(/\bTrue\b/g, 'true');
			jsonString = jsonString.replace(/\bFalse\b/g, 'false');
			
			jsonString = jsonString.replace(/,\s*}/g, '}');
			jsonString = jsonString.replace(/,\s*]/g, ']');  
			
			// Step 4: Parse the modified string as JSON
			const parsed = JSON.parse(jsonString);
			
			return parsed;
		} catch (error) {
			console.error("Error parsing Python locals:", error);
			return {};
		}
	}
	
	private async verifyBreakpoints(path: string): Promise<void> {
		
		const bps = this.breakPoints.get(path);
		if (bps) {
			await this.loadSource(path);
			bps.forEach(bp => {
				if (!bp.verified && this._sourceCode && bp.line < this._sourceCode?.getLength()) {
					const srcLine = this.getLine(bp.line);
					
					// if a line is empty or starts with '+' we don't allow to set a breakpoint but move the breakpoint down
					if (srcLine.length === 0 || srcLine.indexOf('+') === 0) {
						bp.line++;
					}
					// if a line starts with '-' we don't allow to set a breakpoint but move the breakpoint up
					if (srcLine.indexOf('-') === 0) {
						bp.line--;
					}
					
					// verify the breakpoint
					bp.verified = true;
					this.sendEvent('breakpointValidated', bp);
				}
			});
		}
	}
	
	private sendEvent(event: string, ... args: any[]): void {
		setTimeout(() => {
			this.emit(event, ...args);
		}, 0);
	}
	
	private normalizePathAndCasing(path: string) {
		if (this.fileAccessor.isWindows) {
			return path.replace(/\//g, '\\').toLowerCase();
		} else {
			return path.replace(/\\/g, '/');
		}
	}
	
	private isDebuggerOutput(output: string): boolean {
		const check = output.includes('(Pdb)') || output.startsWith('>') || output.startsWith('->') || output.startsWith('---Return---') || output.startsWith('\'{');
		return check;
	}

	private isVariablesOutput(output: string): boolean {
		return output.startsWith('\'{');
	}
}
