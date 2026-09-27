import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class AdbManager {
    private readonly storagePath: string;
    private readonly platform: NodeJS.Platform;
    private readonly binaryName: string;
    private adbPath: string | null = null;

    private static readonly DOWNLOAD_URLS: Record<string, string> = {
        win32: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
        darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
        linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip'
    };

    constructor(context: vscode.ExtensionContext) {
        this.storagePath = context.globalStorageUri.fsPath;
        this.platform = process.platform;
        this.binaryName = this.platform === 'win32' ? 'adb.exe' : 'adb';
    }

    /**
     * Resolves the path to the ADB binary, downloading it if necessary.
     */
    public async getAdbPath(): Promise<string> {
        if (this.adbPath && fs.existsSync(this.adbPath)) {
            return this.adbPath;
        }

        // 1. Check system PATH first
        const systemPath = await this.findSystemAdb();
        if (systemPath) {
            this.adbPath = systemPath;
            return systemPath;
        }

        // 2. Check local extension storage
        const localPath = path.join(this.storagePath, 'platform-tools', this.binaryName);
        if (fs.existsSync(localPath)) {
            this.adbPath = localPath;
            return localPath;
        }

        // 3. Download from Google SDK repositories
        this.adbPath = await this.downloadAndExtract();
        return this.adbPath;
    }

    /**
     * Establishes port forwarding (e.g., adb forward tcp:5277 tcp:5277)
     */
    public async forwardPort(localPort: number = 5277, remotePort: number = 5277): Promise<void> {
        const adb = await this.getAdbPath();
        const command = `"${adb}" forward tcp:${localPort} tcp:${remotePort}`;
        await execAsync(command);
    }

    /**
     * Returns a list of attached device/emulator IDs
     */
    public async getConnectedDevices(): Promise<string[]> {
        const adb = await this.getAdbPath();
        const { stdout } = await execAsync(`"${adb}" devices`);

        return stdout
            .split('\n')
            .slice(1) // Skip "List of devices attached"
            .map(line => line.trim())
            .filter(line => line.length > 0 && line.includes('\tdevice'))
            .map(line => line.split('\t')[0]);
    }

    private async findSystemAdb(): Promise<string | null> {
        const cmd = this.platform === 'win32' ? `where ${this.binaryName}` : `which ${this.binaryName}`;
        try {
            const { stdout } = await execAsync(cmd);
            const foundPath = stdout.split(/\r?\n/)[0].trim();
            return foundPath.length > 0 ? foundPath : null;
        } catch {
            return null;
        }
    }

    private async downloadAndExtract(): Promise<string> {
        const downloadUrl = AdbManager.DOWNLOAD_URLS[this.platform];
        if (!downloadUrl) {
            throw new Error(`Unsupported OS platform: ${this.platform}`);
        }

        const platformToolsDir = path.join(this.storagePath, 'platform-tools');
        const zipPath = path.join(this.storagePath, 'tools.zip');
        const targetAdb = path.join(platformToolsDir, this.binaryName);

        await fs.promises.mkdir(this.storagePath, { recursive: true });

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Setting up ADB (Android Debug Bridge)...",
            cancellable: false
        }, async () => {
            // Download zip
            await this.downloadFile(downloadUrl, zipPath);

            // Extract archive
            if (this.platform === 'win32') {
                const psCmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${this.storagePath}' -Force"`;
                await execAsync(psCmd);
            } else {
                await execAsync(`unzip -o "${zipPath}" -d "${this.storagePath}"`);
            }

            // Cleanup ZIP file
            await fs.promises.unlink(zipPath);

            // Ensure executable rights on macOS/Linux
            if (this.platform !== 'win32') {
                await fs.promises.chmod(targetAdb, 0o755);
            }
        });

        if (!fs.existsSync(targetAdb)) {
            throw new Error("Extraction complete, but ADB binary was not found.");
        }

        return targetAdb;
    }

    private downloadFile(url: string, dest: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = https.get(url, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    const redirectUrl = response.headers.location;
                    if (!redirectUrl) {
                        return reject(new Error('Received HTTP redirect without Location header.'));
                    }
                    this.downloadFile(redirectUrl, dest).then(resolve).catch(reject);
                    return;
                }

                if (response.statusCode !== 200) {
                    return reject(new Error(`Failed to download ADB: HTTP ${response.statusCode}`));
                }

                const fileStream = fs.createWriteStream(dest);
                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close(() => resolve());
                });

                fileStream.on('error', (err) => {
                    fs.unlink(dest, () => reject(err));
                });
            });

            request.on('error', (err) => reject(err));
        });
    }
}