/**
 * One chrome-devtools-mcp connection to the person's Chrome for a whole check,
 * for a session whose agent has no chrome-devtools tools loaded. Chrome asks
 * the person to allow every new connection, so a check holds one and sends
 * each step to it.
 *
 *   node devtools-session.mjs serve           # background; prints "ready" once allowed
 *   node devtools-session.mjs send '<steps>'  # steps: [["list_pages",{}],["take_snapshot",{"pageId":9}]]
 *   node devtools-session.mjs send '[["quit"]]'
 *
 * A step is a chrome-devtools-mcp tool name and its arguments, run in order;
 * the reply is their text output. Page tools take an explicit `pageId` from
 * `list_pages`. Files the tools write land in the OS temp directory.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = Number(process.env.GV_DEVTOOLS_PORT ?? 47391);
const [mode, steps] = process.argv.slice(2);

if (mode === 'send') {
  const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST' }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => process.stdout.write(chunk));
  });
  req.on('error', (error) => {
    console.error(`no session on port ${PORT}: ${error.message}`);
    process.exitCode = 1;
  });
  req.end(steps ?? '[]');
} else if (mode === 'serve') {
  const server = spawn(
    'npx',
    [
      '-y',
      'chrome-devtools-mcp@latest',
      '--autoConnect',
      '--no-usage-statistics',
      '--categoryExtensions=true',
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const pending = new Map();
  let nextId = 0;
  let buffered = '';
  server.stdout.on('data', (chunk) => {
    buffered += chunk;
    for (let end; (end = buffered.indexOf('\n')) >= 0;) {
      const line = buffered.slice(0, end).trim();
      buffered = buffered.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  const send = (message) =>
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      send({ id, method, params });
    });
  const stop = () => {
    server.kill();
    process.exit(0);
  };

  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'voyager-verify', version: '1' },
  });
  send({ method: 'notifications/initialized' });
  // The first call opens the connection Chrome asks the person to allow.
  await rpc('tools/call', { name: 'list_pages', arguments: {} });
  process.stdout.write('ready\n');

  http
    .createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        const out = [];
        try {
          for (const [name, args = {}] of JSON.parse(body)) {
            if (name === 'quit') {
              res.end('bye\n');
              setTimeout(stop, 50);
              return;
            }
            const reply = await rpc('tools/call', { name, arguments: args });
            if (reply.error) throw new Error(`${name}: ${JSON.stringify(reply.error)}`);
            for (const part of reply.result?.content ?? []) {
              out.push(part.type === 'text' ? part.text : `[${part.type}]`);
            }
          }
        } catch (error) {
          out.push(`ERROR ${error.message}`);
        }
        res.end(`${out.join('\n')}\n`);
      });
    })
    .listen(PORT, '127.0.0.1');
} else {
  console.error('usage: devtools-session.mjs serve | send <json steps>');
  process.exitCode = 1;
}
