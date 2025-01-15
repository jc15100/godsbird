const { DebugSession, InitializedEvent, StoppedEvent, BreakpointEvent, ThreadEvent } = require('vscode-debugadapter');
const { DebugProtocol } = require('vscode-debugprotocol');
const { EventEmitter } = require('events');

class TxtDebugSession extends DebugSession {
    constructor() {
        super();
        console.log('Creating debug adapter');
        this._breakPoints = new Map(); // Track breakpoints per file
    }

    initializeRequest(response, args) {
        // Initial setup when a debug session starts
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true; // Enable configurationDoneRequest
        this.sendResponse(response);

        // Notify that initialization is done
        this.sendEvent(new InitializedEvent());
        console.log('Initialize debug adapter');
    }

    launchRequest(response, args) {
        // Called when launching the debug session
        this.sendResponse(response);

        console.log('Launching debug adapter');

        // Simulate that the program is running (this is where you handle debugging logic)
        setTimeout(() => {
            this.sendEvent(new StoppedEvent('breakpoint', 1)); // Simulate hitting a breakpoint
        }, 1000);
    }

    setBreakPointsRequest(response, args) {
        console.log('Setting breakpoints');
        const path = args.source.path;
        const breakpoints = args.breakpoints || [];

        // Save breakpoints for the file
        this._breakPoints.set(path, breakpoints);

        const actualBreakpoints = breakpoints.map((bp) => {
            return { verified: true, line: bp.line }; // Verify breakpoints
        });

        response.body = {
            breakpoints: actualBreakpoints
        };
        this.sendResponse(response);
    }

    threadsRequest(response) {
        // Returns a single "main" thread for simplicity
        response.body = {
            threads: [{ id: 1, name: "main" }]
        };
        this.sendResponse(response);
    }

    stackTraceRequest(response, args) {
        console.log('Getting stack trace');
        // Provide the current call stack (simple for demonstration)
        response.body = {
            stackFrames: [{
                id: 1,
                name: "main",
                line: 10,  // Simulated line
                column: 1,
                source: { path: "path/to/current-file.txt" }
            }],
            totalFrames: 1
        };
        this.sendResponse(response);
    }

    // You can implement additional requests like step, evaluate, etc.
}

DebugSession.run(TxtDebugSession);