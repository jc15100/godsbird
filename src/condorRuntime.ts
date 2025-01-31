import { EventEmitter } from 'events';
import { setupExecutable, setupExecutionContext, generateCode, executeCode, debugCode } from './common';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { Socket } from 'net';

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
	private _memory?: Uint8Array;

	public reference?: number;

	public get value() {
		return this._value;
	}

	public set value(value: IRuntimeVariableType) {
		this._value = value;
		this._memory = undefined;
	}

	public get memory() {
		if (this._memory === undefined && typeof this._value === 'string') {
			this._memory = new TextEncoder().encode(this._value);
		}
		return this._memory;
	}

	constructor(public readonly name: string, private _value: IRuntimeVariableType) {}

	public setMemory(data: Uint8Array, offset = 0) {
		const memory = this.memory;
		if (!memory) {
			return;
		}

		memory.set(data, offset);
		this._memory = memory;
		this._value = new TextDecoder().decode(memory);
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
 *  The variables and results from generated code are shown in the debug UI.
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

	private _codeHistory: string[] = [];

	constructor(private fileAccessor: FileAccessor) {
		super();
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
		let doContinue = true;
		while (doContinue) {
			doContinue = await this.executeLine(this.currentLine, reverse);
			if (this.updateCurrentLine(reverse)) {
				break;
			}
			if (this.findNextStatement(reverse)) {
				break;
			}
		}
	}

	/**
	 * Step to the next/previous non empty line.
	 */
	public step(instruction: boolean, reverse: boolean) {

		if (instruction) {
			if (reverse) {
				this.instruction--;
			} else {
				this.instruction++;
			}
			this.sendEvent('stopOnStep');
		} else {
			if (!this.executeLine(this.currentLine, reverse)) {
				if (!this.updateCurrentLine(reverse)) {
					this.findNextStatement(reverse, 'stopOnStep');
				}
			}
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
			if (this.currentLine < this._sourceCode?.getLength()-1) {
				this.currentLine++;
			} else {
				// no more lines: run to end
				this.currentColumn = undefined;
				this.sendEvent('end');
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
				if (this.currentColumn <= this._sourceCode?.getLine(this.currentLine).length) {
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
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
	public stack(startFrame: number, endFrame: number): IRuntimeStack {

		// TODO: Implement this
		
		const line = this.getLine();
		const words = this.getWords(this.currentLine, line);
		words.push({ name: 'BOTTOM', line: -1, index: -1 });	// add a sentinel so that the stack is never empty...

		// if the line contains the word 'disassembly' we support to "disassemble" the line by adding an 'instruction' property to the stackframe
		const instruction = line.indexOf('disassembly') >= 0 ? this.instruction : undefined;

		const column = typeof this.currentColumn === 'number' ? this.currentColumn : undefined;

		const frames: IRuntimeStackFrame[] = [];
		// every word of the current line becomes a stack frame.
		for (let i = startFrame; i < Math.min(endFrame, words.length); i++) {

			const stackFrame: IRuntimeStackFrame = {
				index: i,
				name: `${words[i].name}(${i})`,	// use a word of the line as the stackframe name
				file: this._sourceFile,
				line: this.currentLine,
				column: column, // words[i].index
				instruction: instruction ? instruction + i : 0
			};

			frames.push(stackFrame);
		}

		return {
			frames: frames,
			count: words.length
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

	public async getGlobalVariables(cancellationToken?: () => boolean ): Promise<RuntimeVariable[]> {
		// TODO: Build this using underlying python running on code
		let a: RuntimeVariable[] = [];

		for (let i = 0; i < 10; i++) {
			a.push(new RuntimeVariable(`global_${i}`, i));
			if (cancellationToken && cancellationToken()) {
				break;
			}
			await timeout(1000);
		}

		return a;
	}

	public getLocalVariables(): RuntimeVariable[] {
		// // TODO: Build this using underlying python running on code
		return Array.from(this.variables, ([name, value]) => value);
	}

	public getLocalVariable(name: string): RuntimeVariable | undefined {
		// TODO: Build this using underlying python running on code
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

		for (let ln = this.currentLine; reverse ? ln >= 0 : ln < this._sourceCode?.getLength(); reverse ? ln-- : ln++) {

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
	 * "execute a line" of the readme markdown.
	 * Returns true if execution sent out a stopped event and needs to stop.
	 */
	private async executeLine(ln: number, reverse: boolean): Promise<boolean> {
		const currentCode = this.getLine(ln);
		
		if (currentCode.length !== 0) {
			if (this._context === undefined) {
				this._context = await setupExecutionContext(this._sourceFile);
			}
			
			// add visited line to lines seen so far & concatenate to send to model
			this._codeHistory.push(currentCode);

			const executableText = this._context + "\n" + this._codeHistory.join('\n');

			const code = await generateCode(executableText);
			const stdout = await debugCode(code);
		}

		// nothing interesting found -> continue
		return false;
	}

	private async verifyBreakpoints(path: string): Promise<void> {

		const bps = this.breakPoints.get(path);
		if (bps) {
			await this.loadSource(path);
			bps.forEach(bp => {
				if (!bp.verified && bp.line < this._sourceCode?.getLength()) {
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

	private async launchRequest2(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments) {
	
			// step 1: get the raw text from the file specified
			this._sourceCode  = new SourceCode(args.program);
	
			let executable = await setupExecutable(this._sourceCode.getCode());
	
			// step 2: generate the code using the model
			// step 3: provide the code (temporary file) to the pdb compiler
	
			this.pdbOption(executable?.path);
	
			// console.log(this._sourceCode.getLine(0));
	
			// start the program in the runtime
			// await this._runtime.start(args.program, !!args.stopOnEntry, !args.noDebug);
	
			this.sendResponse(response);
	}

	private sendRequestToPythonDebugger(
			command: string, args: any, response: DebugProtocol.Response
		) {
			const message = {
				command,
				args
			};
			// Send message to the Python debugger process via stdin
			this._debugProcess.stdin.write(JSON.stringify(message) + '\n');
			
			// You would also handle responses from debugpy via stdout
			this._debugProcess.stdout.on('data', (data) => {
				const responseData = JSON.parse(data);
				this.sendResponse(responseData);
			});
		}
	
		private pydevOption(args) {
			const pythonArgs = ['-m', 'pydevd', '--client', 'localhost', '--port', '5678', '--file', args.program];
		
			const pythonProcess = spawn('python', pythonArgs);
		
			pythonProcess.stdout.on('data', (data) => {
				this.sendEvent(new OutputEvent(`stdout: ${data}`, 'stdout'));
			});
		
			pythonProcess.stderr.on('data', (data) => {
				this.sendEvent(new OutputEvent(`stderr: ${data}`, 'stderr'));
			});
		
			this._debugProcess = pythonProcess;
	
			this._debugSocket = new Socket();
			this._debugSocket.connect(5678, 'localhost', () => {
				console.log('Connected to Python debugger (pydevd)');
			});
	
			this._debugSocket.on('data', (data) => {
				console.log(`Received from debugger: ${data}`);
			});
	
			this._debugSocket.on('close', () => {
				console.log('Connection to Python debugger closed');
			});
		}
	
		private pdbOption(program: string) {
			const pythonArgs = ['-m', 'pdb', program]; // Use `pdb` for Python debugging
		
			// Spawn the Python process with the necessary arguments
			this._debugProcess = spawn('python', pythonArgs, {
				stdio: ['pipe', 'pipe', 'pipe'] // Enable stdin, stdout, stderr for communication
			});
	
			// Handle stdout from the Python process (debugger output)
			this._debugProcess.stdout.on('data', (data) => {
				console.log(`stdout: ${data.toString()}`);
				// Send data back to the VSCode Debug Adapter (optional)
				if (data.toString().includes('->')) {
					const lineInfo = this.extractLineNumberFromPdbOutput(data.toString());
					this.sendStoppedEventForStep(lineInfo);
				}
	
				this.sendEvent(new OutputEvent(data.toString(), 'stdout'));
			});
	
			// Handle stderr from the Python process
			this._debugProcess.stderr.on('data', (data) => {
				console.log(`stderr: ${data}`);
				this.sendEvent(new OutputEvent(data.toString(), 'stderr'));
			});
	
			// Handle process exit
			this._debugProcess.on('exit', (code) => {
				console.log(`Python process exited with code ${code}`);
			});
		}


			private sendPyDev(args) {
				const breakpoints = args.breakpoints.map(b => {
					return { file: args.source.path, line: b.line };
				});
				
				const breakpointsCommand = JSON.stringify({ command: 'set_breakpoints', breakpoints });
				
				// Send the breakpoints command to the Python debugger (e.g., via socket)
				this._debugSocket.write(breakpointsCommand);
			}
		
			private sendPdb(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {
				// Create the 'break' command for pdb
				const breakpoints = args.breakpoints.map(b => `break ${args.source.path}:${b.line}`).join('\n');
			
				// Send the breakpoints command to the Python process via stdin
				this._debugProcess.stdin.write(`${breakpoints}\n`);
			}
		
			private extractLineNumberFromPdbOutput(output) {
				// Parse the output to extract the line number and file path
				const lineMatch = output.match(/> ([^ ]+) \((\d+)\)/);
				if (lineMatch) {
					return {
						filePath: lineMatch[1],
						lineNumber: parseInt(lineMatch[2], 10)
					};
				}
				return null;
			}
		
			private sendStoppedEventForBreakpoint(lineInfo) {
				const { filePath, lineNumber } = lineInfo;
				this.sendEvent(new StoppedEvent('breakpoint', /* threadId */ 1));
				this.sendEvent(new OutputEvent(`Breakpoint hit at ${filePath}:${lineNumber}\n`));
			}
		
			private sendStoppedEventForStep(lineInfo) {
				const { filePath, lineNumber } = lineInfo;
				this.sendEvent(new StoppedEvent('step', /* threadId */ 1));
				this.sendEvent(new OutputEvent(`Stepped to ${filePath}:${lineNumber}\n`));
			}
	
}
