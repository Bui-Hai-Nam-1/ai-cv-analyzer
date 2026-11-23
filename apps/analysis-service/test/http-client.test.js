
const test = require('node:test');
const assert = require('node:assert/strict');

// Thiết lập timeout ngắn để test không phải chờ lâu.
process.env.HTTP_TIMEOUT_MS = '50';
process.env.HTTP_RETRIES = '1';

const { getWithRetry } = require('../src/services/http-client');

const originalFetch = global.fetch;

test('Returns JSON when upstream responds successfully', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 1, name: 'Test CV' })
  });

  try {
    const result = await getWithRetry('http://test/cvs/1');

    assert.deepEqual(result, {
      id: 1,
      name: 'Test CV'
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('Does not retry business errors (404)', async () => {
  let calls = 0;

  global.fetch = async () => {
    calls++;

    return {
      ok: false,
      status: 404
    };
  };

  try {
    await assert.rejects(
      getWithRetry('http://test/cvs/999'),
      error => error.status === 404
    );

    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Retries when upstream returns HTTP 500', async () => {
  let calls = 0;

  global.fetch = async () => {
    calls++;

    if (calls === 1) {
      return {
        ok: false,
        status: 500
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ message: 'Recovered' })
    };
  };

  try {
    const result = await getWithRetry('http://test/cvs/1');

    assert.equal(calls, 2);
    assert.deepEqual(result, { message: 'Recovered' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('Returns 503 after network errors and retries', async () => {
  let calls = 0;

  global.fetch = async () => {
    calls++;
    throw new Error('Network unavailable');
  };

  try {
    await assert.rejects(
      getWithRetry('http://test/cvs/1'),
      error => error.status === 503 &&
        error.message === 'UPSTREAM_UNAVAILABLE'
    );

    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Returns 504 when upstream times out', async () => {
  let calls = 0;

  global.fetch = async (_url, options) => {
    calls++;

    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('Request aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };

  try {
    await assert.rejects(
      getWithRetry('http://test/cvs/1'),
      error => error.status === 504 &&
        error.message === 'UPSTREAM_TIMEOUT'
    );

    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});
