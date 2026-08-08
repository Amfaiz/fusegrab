import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { downloadArtifact } from '@electron/get';
import extractZip from 'extract-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const electronDir = path.join(projectRoot, 'node_modules', 'electron');
const distDir = path.join(electronDir, 'dist');
const pathFile = path.join(electronDir, 'path.txt');

function getPlatformExecutable() {
    switch (process.platform) {
        case 'darwin':
            return 'Electron.app/Contents/MacOS/Electron';
        case 'win32':
            return 'electron.exe';
        default:
            return 'electron';
    }
}

function verifyElectronInstallation() {
    if (!fs.existsSync(electronDir)) return false;
    if (!fs.existsSync(pathFile)) return false;

    const relPath = fs.readFileSync(pathFile, 'utf-8').trim();
    if (!relPath) return false;

    const execPath = path.join(distDir, relPath);
    if (!fs.existsSync(execPath)) return false;

    try {
        const stats = fs.statSync(execPath);
        // Valid Electron executable is ~50KB+ on macOS arm64
        return stats.size > 10000;
    } catch {
        return false;
    }
}

function ensurePathTxt() {
    const relPath = getPlatformExecutable();
    fs.writeFileSync(pathFile, relPath, 'utf-8');
    const versionFile = path.join(distDir, 'version');
    if (fs.existsSync(distDir) && !fs.existsSync(versionFile)) {
        fs.writeFileSync(versionFile, '33.4.11', 'utf-8');
    }
}

async function installElectron() {
    if (!fs.existsSync(electronDir)) return;

    if (verifyElectronInstallation()) {
        ensurePathTxt();
        console.log('✓ Electron binary verified.');
        return;
    }

    console.log('[postinstall-electron] Electron binary missing or invalid. Installing clean binary...');

    let zipPath;
    try {
        zipPath = await downloadArtifact({
            version: '33.4.11',
            artifactName: 'electron',
            platform: process.platform,
            arch: process.arch
        });
    } catch (err) {
        console.error('[postinstall-electron] Download failed:', err.message);
        ensurePathTxt();
        return;
    }

    try {
        fs.rmSync(distDir, { recursive: true, force: true });
        fs.mkdirSync(distDir, { recursive: true });

        if (process.platform === 'darwin' || process.platform === 'linux') {
            execSync(`unzip -q -o "${zipPath}" -d "${distDir}"`, { stdio: 'inherit' });
        } else {
            await extractZip(zipPath, { dir: distDir });
        }
        ensurePathTxt();
        console.log('✓ Electron binary successfully installed.');
    } catch (err) {
        console.error('[postinstall-electron] Extraction failed:', err.message);
        ensurePathTxt();
    }
}

installElectron().catch(console.error);
