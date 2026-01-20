import * as vscode from 'vscode';
import { Client } from '@xhayper/discord-rpc';

let rpcClient: Client | null = null;
let startTimestamp: number = Date.now();
let activityUpdateInterval: NodeJS.Timeout | null = null;

export function activate(context: vscode.ExtensionContext) {
    console.log('Peanut Presence extension is now active!');

    // Initialize start timestamp (persists across file changes)
    startTimestamp = Date.now();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('peanutpresence.enable', () => {
            vscode.workspace.getConfiguration('peanutpresence').update('enabled', true, true);
            connectToDiscord();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('peanutpresence.disable', () => {
            vscode.workspace.getConfiguration('peanutpresence').update('enabled', false, true);
            disconnectFromDiscord();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('peanutpresence.reconnect', () => {
            disconnectFromDiscord();
            setTimeout(() => connectToDiscord(), 1000);
        })
    );

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('peanutpresence')) {
                disconnectFromDiscord();
                setTimeout(() => connectToDiscord(), 1000);
            }
        })
    );

    // Listen for active editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            updateActivity();
        })
    );

    // Listen for workspace folder changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            updateActivity();
        })
    );

    // Initial connection
    connectToDiscord();
}

async function connectToDiscord() {
    const config = vscode.workspace.getConfiguration('peanutpresence');
    const enabled = config.get<boolean>('enabled', true);

    if (!enabled) {
        console.log('Peanut Presence is disabled');
        return;
    }

    const appId = config.get<string>('applicationId', '')?.trim();

    if (!appId) {
        vscode.window.showWarningMessage(
            'Peanut Presence: Please set your Discord Application ID in settings',
            'Open Settings'
        ).then(selection => {
            if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'peanutpresence.applicationId');
            }
        });
        return;
    }

    try {
        if (rpcClient) {
            await disconnectFromDiscord();
        }

        console.log(`Peanut Presence: Attempting to connect with App ID: ${appId}`);

        // Debug info for macOS connection issues
        if (process.platform === 'darwin') {
            const tempDir = process.env.TMPDIR || '/tmp';
            console.log(`Peanut Presence (macOS Debug): TMPDIR is ${tempDir}`);
            try {
                const fs = require('fs');
                const path = require('path');
                const files = fs.readdirSync(tempDir);
                const discordFiles = files.filter((f: string) => f.includes('discord-ipc'));
                console.log(`Peanut Presence (macOS Debug): Found discord-ipc files in TMPDIR: ${discordFiles.join(', ') || 'None'}`);
            } catch (e) {
                console.log(`Peanut Presence (macOS Debug): Failed to read TMPDIR: ${e}`);
            }
        }

        rpcClient = new Client({ clientId: appId });

        rpcClient.on('ready', () => {
            console.log('Peanut Presence: Discord RPC ready!');
            updateActivity();

            if (activityUpdateInterval) {
                clearInterval(activityUpdateInterval);
            }
            activityUpdateInterval = setInterval(() => {
                updateActivity();
            }, 15000);
        });

        rpcClient.on('connected', () => {
            console.log('Peanut Presence: Connected to Discord socket');
        });

        rpcClient.on('disconnected', () => {
            console.log('Peanut Presence: Discord RPC disconnected');
            if (activityUpdateInterval) {
                clearInterval(activityUpdateInterval);
                activityUpdateInterval = null;
            }
        });

        rpcClient.on('debug', (message) => {
            console.log(`Peanut Presence (Debug): ${message}`);
        });

        // Use a timeout for the login process to prevent hanging
        await Promise.race([
            rpcClient.login(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Connection timed out. Is Discord running?')), 10000)
            )
        ]);

    } catch (error) {
        console.error('Peanut Presence: Failed to connect:', error);
        vscode.window.showErrorMessage(`Peanut Presence: Failed to connect to Discord - ${error}`);

        if (rpcClient) {
            await disconnectFromDiscord();
        }
    }
}

async function disconnectFromDiscord() {
    if (activityUpdateInterval) {
        clearInterval(activityUpdateInterval);
        activityUpdateInterval = null;
    }

    if (rpcClient) {
        try {
            await rpcClient.user?.clearActivity();
            await rpcClient.destroy();
        } catch (e) {
            console.error('Peanut Presence: Error during disconnect:', e);
        }
        rpcClient = null;
        console.log('Peanut Presence: Disconnected');
    }
}

async function updateActivity() {
    if (!rpcClient || !rpcClient.user) {
        return;
    }

    const editor = vscode.window.activeTextEditor;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    // Get current file info
    let fileName = 'Idle';
    let fileType = '';

    if (editor) {
        const document = editor.document;
        // Improved file name extraction
        fileName = document.fileName.replace(/\\/g, '/').split('/').pop() || 'Unknown file';
        fileType = document.languageId;
    }

    // Get workspace name
    const workspaceName = workspaceFolder?.name || 'No workspace';

    const config = vscode.workspace.getConfiguration('peanutpresence');

    // Get button configuration
    const buttonLabel = config.get<string>('buttonLabel', '');
    const buttonUrl = config.get<string>('buttonUrl', '');

    // Build base activity
    const activity: any = {
        details: editor ? `Editing ${fileName}` : 'Idle',
        state: `Workspace: ${workspaceName}`,
        startTimestamp: startTimestamp,
        largeImageKey: 'vscode',
        largeImageText: 'Visual Studio Code',
        smallImageKey: fileType,
        smallImageText: fileType.toUpperCase(),
        instance: false,
        type: 0
    };

    // Add button if label and url are set
    if (buttonLabel && buttonUrl) {
        console.log(`Setting button: ${buttonLabel} -> ${buttonUrl}`);
        activity.buttons = [
            { label: buttonLabel, url: buttonUrl }
        ];
    }

    try {
        console.log('Final activity object:', JSON.stringify(activity, null, 2));
        // Set activity with a timeout to prevent hanging
        await Promise.race([
            rpcClient.user.setActivity(activity),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Activity update timeout')), 5000)
            )
        ]);

        console.log('Activity set successfully');
    } catch (error) {
        console.error('Failed to set activity:', error);
        // Don't show error message every time it fails to avoid spamming the user
        // but maybe log it to the output channel if we had one.
    }
}

export function deactivate() {
    disconnectFromDiscord();
}
