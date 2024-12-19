import * as vscode from 'vscode';
import * as path from 'path';
import * as childprocess from 'child_process';
import { promisify } from 'util';

///
/// condor.debug functionality
///
export async function debug() {
    vscode.window.showErrorMessage('Debugger not implemented');
}
