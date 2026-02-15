/**
 * Antigravity Claude Proxy
 * Entry point - starts the proxy server
 */

// Initialize proxy support BEFORE any other imports that may use fetch
import './utils/proxy.js';

import app, { accountManager } from './server.js';
import { DEFAULT_PORT } from './constants.js';
import { logger } from './utils/logger.js';
import { config } from './config.js';
import { getStrategyLabel, STRATEGY_NAMES, DEFAULT_STRATEGY } from './account-manager/strategies/index.js';
import { getPackageVersion } from './utils/helpers.js';
import path from 'path';
import os from 'os';

const packageVersion = getPackageVersion();

// Parse command line arguments
const args = process.argv.slice(2);
const isDebug = args.includes('--debug') || args.includes('--dev-mode') || process.env.DEBUG === 'true' || process.env.DEV_MODE === 'true';
const isFallbackEnabled = args.includes('--fallback') || process.env.FALLBACK === 'true';

// Parse --strategy flag (format: --strategy=sticky or --strategy sticky)
let strategyOverride = null;
for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--strategy=')) {
        strategyOverride = args[i].split('=')[1];
    } else if (args[i] === '--strategy' && args[i + 1]) {
        strategyOverride = args[i + 1];
    }
}
// Validate strategy
if (strategyOverride && !STRATEGY_NAMES.includes(strategyOverride.toLowerCase())) {
    logger.warn(`[Startup] Invalid strategy "${strategyOverride}". Valid options: ${STRATEGY_NAMES.join(', ')}. Using default.`);
    strategyOverride = null;
}

// Parse --provider flag (format: --provider=chutes or --provider chutes)
let providerOverride = null;
for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--provider=')) {
        providerOverride = args[i].split('=')[1];
    } else if (args[i] === '--provider' && args[i + 1]) {
        providerOverride = args[i + 1];
    }
}
const VALID_PROVIDERS = ['cloudcode', 'chutes'];
if (providerOverride && !VALID_PROVIDERS.includes(providerOverride.toLowerCase())) {
    logger.warn(`[Startup] Invalid provider "${providerOverride}". Valid options: ${VALID_PROVIDERS.join(', ')}. Using default.`);
    providerOverride = null;
}
const activeProvider = providerOverride || process.env.PROVIDER || config.provider || 'cloudcode';
const isChutesMode = activeProvider === 'chutes';

// Initialize logger and devMode
logger.setDebug(isDebug);

if (isDebug) {
    config.devMode = true;
    config.debug = true;
    logger.debug('Developer mode enabled');
}

if (isFallbackEnabled) {
    logger.info('Model fallback mode enabled');
}

if (isChutesMode) {
    logger.info('Provider: Chutes.ai (OpenAI-compatible)');
}

// Export fallback flag for server to use
export const FALLBACK_ENABLED = isFallbackEnabled;

const PORT = process.env.PORT || DEFAULT_PORT;
const HOST = process.env.HOST || '0.0.0.0';

if (process.env.HOST) {
    logger.info(`[Startup] Using HOST environment variable: ${process.env.HOST}`);
}

// Home directory for account storage
const HOME_DIR = os.homedir();
const CONFIG_DIR = path.join(HOME_DIR, '.antigravity-claude-proxy');

const server = app.listen(PORT, HOST, () => {
    // Get actual bound address
    const address = server.address();
    const boundHost = typeof address === 'string' ? address : address.address;
    const boundPort = typeof address === 'string' ? null : address.port;

    // Clear console for a clean start
    console.clear();

    const border = '║';
    // align for 2-space indent (60 chars), align4 for 4-space indent (58 chars)
    const align = (text) => text + ' '.repeat(Math.max(0, 60 - text.length));
    const align4 = (text) => text + ' '.repeat(Math.max(0, 58 - text.length));

    // Build Control section dynamically
    const strategyOptions = `(${STRATEGY_NAMES.join('/')})`;
    const strategyLine2 = '                       ' + strategyOptions;
    let controlSection = '║  Control:                                                    ║\n';
    controlSection += '║    --provider=<p>     Set backend (cloudcode/chutes)         ║\n';
    controlSection += '║    --strategy=<s>     Set account selection strategy         ║\n';
    controlSection += `${border}  ${align(strategyLine2)}${border}\n`;
    if (!isDebug) {
        controlSection += '║    --dev-mode         Enable developer mode                  ║\n';
    }
    if (!isFallbackEnabled) {
        controlSection += '║    --fallback         Enable model fallback on quota exhaust ║\n';
    }
    controlSection += '║    Ctrl+C             Stop server                            ║';

    // Get the strategy label (accountManager will be initialized by now)
    const strategyLabel = accountManager.getStrategyLabel();

    // Build status section - always show strategy, plus any active modes
    let statusSection = '║                                                              ║\n';
    statusSection += '║  Active Modes:                                               ║\n';
    statusSection += `${border}    ${align4(`✓ Provider: ${isChutesMode ? 'Chutes.ai' : 'Cloud Code'}`)}${border}\n`;
    if (!isChutesMode) {
        statusSection += `${border}    ${align4(`✓ Strategy: ${strategyLabel}`)}${border}\n`;
    }
    if (isDebug) {
        statusSection += '║    ✓ Developer mode enabled                                   ║\n';
    }
    if (isFallbackEnabled) {
        statusSection += '║    ✓ Model fallback enabled                                  ║\n';
    }
    if (process.env.CLAUDE_CONFIG_PATH) {
        statusSection += `${border}    ${align4(`✓ Claude config: ${process.env.CLAUDE_CONFIG_PATH}`)}${border}\n`;
    }

    const environmentSection = `║  Environment Variables:                                      ║
║    PORT                Server port (default: 8080)           ║
║    HOST                Bind address (default: 0.0.0.0)       ║
║    PROVIDER            Backend provider (cloudcode/chutes)   ║
║    CHUTES_API_KEY      API key for Chutes.ai provider        ║
║    CHUTES_BASE_URL     Chutes API URL (llm.chutes.ai)        ║
║    HTTP_PROXY          Route requests through a proxy        ║
║    CLAUDE_CONFIG_PATH  Path to .claude dir (for systemd)     ║
║    See README.md for detailed configuration examples         ║`

    // Build usage section based on provider
    let usageSection;
    if (isChutesMode) {
        usageSection = `║  Usage with Claude Code (Chutes):                            ║
${border}    ${align4(`export ANTHROPIC_BASE_URL=http://localhost:${PORT}`)}${border}
${border}    ${align4(`export ANTHROPIC_API_KEY=${config.apiKey || 'dummy'}`)}${border}
║    claude                                                    ║
║                                                              ║
║  Chutes Setup:                                               ║
║    Set CHUTES_API_KEY env var with your Chutes API key       ║
║    Models: Use Chutes model names (e.g. deepseek-ai/...)    ║`;
    } else {
        usageSection = `║  Usage with Claude Code:                                     ║
${border}    ${align4(`export ANTHROPIC_BASE_URL=http://localhost:${PORT}`)}${border}
${border}    ${align4(`export ANTHROPIC_API_KEY=${config.apiKey || 'dummy'}`)}${border}
║    claude                                                    ║
║                                                              ║
║  Add Google accounts:                                        ║
║    npm run accounts                                          ║
║                                                              ║
║  Prerequisites (if no accounts configured):                  ║
║    - Antigravity must be running                             ║
║    - Have a chat panel open in Antigravity                   ║`;
    }

    logger.log(`
╔══════════════════════════════════════════════════════════════╗
║            Antigravity Claude Proxy Server v${packageVersion}            ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
${border}  ${align(`Server and WebUI running at: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)}${border}
${border}  ${align(`Bound to: ${boundHost}:${boundPort}`)}${border}
${statusSection}║                                                              ║
${controlSection}
║                                                              ║
║  Endpoints:                                                  ║
║    POST /v1/messages         - Anthropic Messages API        ║
║    GET  /v1/models           - List available models         ║
║    GET  /health              - Health check                  ║
║    GET  /account-limits      - Account status & quotas       ║
║    POST /refresh-token       - Force token refresh           ║
║                                                              ║
${border}  ${align(`Configuration:`)}${border}
${border}    ${align4(`Storage: ${CONFIG_DIR}`)}${border}
║                                                              ║
${usageSection}
║                                                              ║
${environmentSection}
╚══════════════════════════════════════════════════════════════╝
  `);

    logger.success(`Server started successfully on port ${PORT}`);
    if (isDebug) {
        logger.warn('Running in DEVELOPER mode - verbose logs enabled');
    }
});

// Graceful shutdown
const shutdown = () => {
    logger.info('Shutting down server...');
    server.close(() => {
        logger.success('Server stopped');
        process.exit(0);
    });

    // Force close if it takes too long
    setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);