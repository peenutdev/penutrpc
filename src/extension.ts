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

    const appId = config.get<string>('applicationId', '');

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
            disconnectFromDiscord();
        }

        rpcClient = new Client({ clientId: appId });

        rpcClient.on('ready', () => {
            console.log('Discord RPC connected!');
            updateActivity();

            // Update activity every 15 seconds to keep it fresh
            if (activityUpdateInterval) {
                clearInterval(activityUpdateInterval);
            }
            activityUpdateInterval = setInterval(() => {
                updateActivity();
            }, 15000);
        });

        rpcClient.on('disconnected', () => {
            console.log('Discord RPC disconnected');
            if (activityUpdateInterval) {
                clearInterval(activityUpdateInterval);
                activityUpdateInterval = null;
            }
        });

        await rpcClient.login();
    } catch (error) {
        console.error('Failed to connect to Discord:', error);
        vscode.window.showErrorMessage(`Peanut Presence: Failed to connect to Discord - ${error}`);
    }
}

function disconnectFromDiscord() {
    if (activityUpdateInterval) {
        clearInterval(activityUpdateInterval);
        activityUpdateInterval = null;
    }

    if (rpcClient) {
        try {
            rpcClient.user?.clearActivity();
            rpcClient.destroy();
        } catch (e) {
            console.error('Error during disconnect:', e);
        }
        rpcClient = null;
        console.log('Disconnected from Discord RPC');
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

    // Get image configuration
    const largeImageKey = config.get<string>('largeImageKey', 'vscode');
    const largeImageText = config.get<string>('largeImageText', 'Visual Studio Code');
    const smallImageKey = config.get<string>('smallImageKey', '');
    const smallImageText = config.get<string>('smallImageText', '');

    // Build base activity
    const activity: any = {
        details: editor ? `Editing ${fileName}` : 'Idle',
        state: `Workspace: ${workspaceName}`,
        startTimestamp: startTimestamp,
        largeImageKey: largeImageKey,
        largeImageText: largeImageText,
        instance: false,
    };

    // Handle small image
    if (smallImageKey) {
        // User specified a custom small image
        activity.smallImageKey = smallImageKey;
        activity.smallImageText = smallImageText;
    } else if (fileType) {
        // Fallback to file type icon if no custom small image is set
        activity.smallImageKey = fileType;
        activity.smallImageText = fileType.toUpperCase();
    }

    try {
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
