// Smoke test: spawn mcp-server.js, send tools/list, verify the expected
// tool surface is registered. Uses a throwaway private key so no real
// wallet is touched.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

// Deterministic throwaway key (well-known ganache test account #0).
// Never holds funds. Used only so the server's startup require()s succeed.
const THROWAWAY_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const SERVER_PATH = path.join(__dirname, '..', 'mcp-server.js');
const SPAWN_TIMEOUT_MS = 10_000;

// The full canonical tool set that mcp-server.js is supposed to register.
// If you add or remove a tool in mcp-server.js, update this list — the
// purpose of this test is to catch accidental changes to the public surface.
const EXPECTED_TOOLS = [
  // read
  'get_balances', 'get_my_baselings', 'get_baseling', 'get_food_stock',
  'get_garden_status', 'get_assignments', 'get_houses', 'get_pending_poop',
  'get_egg_prices', 'get_global_stats',
  // write
  'buy_egg', 'hatch_egg', 'buy_food', 'feed_baseling', 'claim_poop',
  'assign_worker', 'unassign_worker', 'deposit_garden', 'buy_house',
  'assign_to_house', 'freeze_baseling', 'unfreeze_baseling',
  'resurrect_baseling', 'ensure_approvals',
  // strategy
  'welcome', 'choose_strategy', 'next_actions',
  // tokenomics
  'mft_flywheel', 'tokenomics_metrics', 'why_mft',
  // economy
  'build_phase', 'feeding_guide', 'economy_rules',
  // info
  'game_guide',
];

function rpcRequest(id, method, params) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

async function listTools() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SERVER_PATH], {
      env: { ...process.env, GAME_WALLET_KEY: THROWAWAY_KEY },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    const stderrChunks = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`Timed out after ${SPAWN_TIMEOUT_MS}ms. stderr:\n${stderrChunks.join('')}`));
      }
    }, SPAWN_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      // The server emits one JSON-RPC response per line.
      let nl;
      while ((nl = stdout.indexOf('\n')) !== -1) {
        const line = stdout.slice(0, nl).trim();
        stdout = stdout.slice(nl + 1);
        if (!line) continue;

        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 2 && msg.result) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            child.kill('SIGTERM');
            resolve(msg.result);
          }
        }
      }
    });

    child.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));

    child.on('error', (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(e);
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code} before responding. stderr:\n${stderrChunks.join('')}`));
      }
    });

    // Drive the protocol: initialize, then tools/list.
    child.stdin.write(rpcRequest(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke-test', version: '0.0.0' },
    }));
    child.stdin.write(rpcRequest(2, 'tools/list', {}));
  });
}

test('mcp-server registers the full expected tool set', async () => {
  const result = await listTools();
  assert.ok(Array.isArray(result.tools), 'result.tools should be an array');

  const names = result.tools.map(t => t.name).sort();
  const expected = [...EXPECTED_TOOLS].sort();
  assert.deepEqual(names, expected, 'tool set drift detected — update EXPECTED_TOOLS in smoke.test.js if intentional');
});

test('every tool has a description and an inputSchema', async () => {
  const result = await listTools();
  for (const tool of result.tools) {
    assert.ok(tool.name, 'tool missing name');
    assert.ok(tool.description, `tool ${tool.name} missing description`);
    assert.ok(tool.inputSchema && typeof tool.inputSchema === 'object', `tool ${tool.name} missing inputSchema`);
    assert.equal(tool.inputSchema.type, 'object', `tool ${tool.name} schema.type should be 'object'`);
  }
});
