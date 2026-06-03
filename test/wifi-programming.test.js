const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const wifiPut = path.join(repoRoot, 'resources', 'tools', 'wifi_put.py');

function makeTempFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zebra-wifi-test-'));
  const file = path.join(dir, 'user_main.py');
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

function runPython(args) {
  return new Promise(resolve => {
    const child = cp.spawn('python', args, { cwd: repoRoot });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('close', status => {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

test('wifi_put uploads user_main.py to the HTTP programming endpoint', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: await readBody(req),
    });
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('OK uploaded 38 bytes to /user_main.py\n');
  });

  const port = await listen(server);
  try {
    const userMain = makeTempFile('print("wifi upload works")\n');
    const result = await runPython([
      wifiPut,
      `http://127.0.0.1:${port}`,
      userMain,
      '/user_main.py',
      '--reset',
      '--timeout',
      '3',
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /OK uploaded/);
    assert.match(result.stdout, /Uploaded \d+ bytes/);
    assert.equal(requests.length, 1);

    const requestUrl = new URL(requests[0].url, `http://127.0.0.1:${port}`);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requestUrl.pathname, '/upload');
    assert.equal(requestUrl.searchParams.get('path'), '/user_main.py');
    assert.equal(requestUrl.searchParams.get('reset'), '1');
    assert.equal(requests[0].headers['content-type'], 'application/octet-stream');
    assert.equal(requests[0].body.toString('utf8'), 'print("wifi upload works")\n');
  } finally {
    await close(server);
  }
});

test('wifi_put sends token in query string and X-Zbot-Token header', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push({
      url: req.url,
      headers: req.headers,
      body: await readBody(req),
    });
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('OK uploaded 1 bytes to /lib/helper.py\n');
  });

  const port = await listen(server);
  try {
    const userMain = makeTempFile('x=1\n');
    const result = await runPython([
      wifiPut,
      `http://127.0.0.1:${port}/`,
      userMain,
      '/lib/helper.py',
      '--token',
      'classroom-secret',
      '--timeout',
      '3',
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(requests.length, 1);

    const requestUrl = new URL(requests[0].url, `http://127.0.0.1:${port}`);
    assert.equal(requestUrl.pathname, '/upload');
    assert.equal(requestUrl.searchParams.get('path'), '/lib/helper.py');
    assert.equal(requestUrl.searchParams.get('token'), 'classroom-secret');
    assert.equal(requests[0].headers['x-zbot-token'], 'classroom-secret');
    assert.equal(requests[0].body.toString('utf8'), 'x=1\n');
  } finally {
    await close(server);
  }
});

test('extension manifest exposes Wi-Fi deploy configuration', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const properties = pkg.contributes.configuration.properties;

  assert.deepEqual(properties['zebra.deployTransport'].enum, ['serial', 'ble', 'wifi']);
  assert.equal(properties['zebra.wifiUrl'].default, 'http://192.168.4.1:8080');
  assert.equal(properties['zebra.wifiToken'].default, '');
  assert.equal(properties['zebra.wifiTimeout'].default, 15);
});
