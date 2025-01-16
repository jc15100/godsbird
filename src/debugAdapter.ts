import {
    DebugSession, InitializedEvent, TerminatedEvent,
    StoppedEvent, Breakpoint, BreakpointEvent, Thread,
    StackFrame, Scope, Source, Handles
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import * as path from 'path';
import * as fs from 'fs';

class CustomDebugSession extends DebugSession {

    private static THREAD_ID = 1;

    constructor() {
        super();
        console.log('Debug session started');
    }

    // Event triggered when the debugger is initialized
    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        console.log('InitializeRequest');
        // Send the initialized event
        this.sendEvent(new InitializedEvent());

        // Return capabilities of the debugger
        response.body = {
            supportsConfigurationDoneRequest: true
        };
        this.sendResponse(response);
    }

    // Handle configurationDoneRequest
    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        this.sendResponse(response);
    }

    // Event triggered when a launch request is made
    protected launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments): void {
        // Simulate program start
        this.sendEvent(new StoppedEvent('breakpoint', CustomDebugSession.THREAD_ID));
        this.sendResponse(response);
    }

    // Event triggered when a breakpoint is set
    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
        console.log('SetBreakPointsRequest');
        const breakpoints: Breakpoint[] = [];

        // For each requested breakpoint location
        for (const bp of args.breakpoints || []) {
            const verified = Math.random() < 0.8; // Simulate a 80% chance of being valid
            const breakpoint = new Breakpoint(verified, bp.line);
            breakpoints.push(breakpoint);
        }

        response.body = {
            breakpoints: breakpoints
        };

        this.sendResponse(response);
    }

    // Event triggered when threads are requested
    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        // This simple example assumes a single thread.
        response.body = {
            threads: [new Thread(CustomDebugSession.THREAD_ID, 'Main Thread')]
        };

        this.sendResponse(response);
    }

    // Event triggered when a stack trace is requested
    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        // Just create one dummy stack frame
        const stackFrames = [
            new StackFrame(1, 'frame1', new Source('source.txt', '/path/to/source.txt'), 10, 0)
        ];

        response.body = {
            stackFrames: stackFrames,
            totalFrames: stackFrames.length
        };

        this.sendResponse(response);
    }

    // Event triggered when scopes are requested
    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        // Return a dummy scope
        const scopes = [new Scope('Local', new Handles<number>().create(0), false)];

        response.body = {
            scopes: scopes
        };

        this.sendResponse(response);
    }

    // Event triggered when variables are requested
    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
        // Return some dummy variables
        response.body = {
            variables: [
                { name: 'variable1', type: 'number', value: '42', variablesReference: 0 },
                { name: 'variable2', type: 'string', value: '"hello"', variablesReference: 0 }
            ]
        };

        this.sendResponse(response);
    }

    // Handle the "disconnect" request to end the debugging session
    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
        this.sendEvent(new TerminatedEvent());
        this.sendResponse(response);
    }
}

// Run the debug adapter as a standalone process
DebugSession.run(CustomDebugSession);