
const timeoutMs = Number(process.env.HTTP_TIMEOUT_MS || 2500);

const retries = Math.max(
  0,
  Number.parseInt(process.env.HTTP_RETRIES || '1', 10) || 0
);

const failureThreshold = Math.max(
  1,
  Number.parseInt(process.env.CB_FAILURE_THRESHOLD || '3', 10) || 3
);

const resetTimeoutMs = Math.max(
  1000,
  Number.parseInt(process.env.CB_RESET_TIMEOUT_MS || '10000', 10) || 10000
);

// Mỗi upstream có Circuit Breaker riêng.
const breakers = new Map();

function log(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'analysis-service',
    event,
    ...details
  };

  const output = JSON.stringify(entry);

  if (level === 'ERROR') {
    console.error(output);
  } else {
    console.log(output);
  }
}

function getBreaker(url) {
  const serviceKey = new URL(url).host;

  if (!breakers.has(serviceKey)) {
    breakers.set(serviceKey, {
      state: 'CLOSED',
      failures: 0,
      openedAt: null,
      probeInProgress: false
    });
  }

  return {
    serviceKey,
    breaker: breakers.get(serviceKey)
  };
}

function checkCircuit(breaker, serviceKey) {
  if (breaker.state === 'OPEN') {
    const elapsed = Date.now() - breaker.openedAt;

    if (elapsed >= resetTimeoutMs) {
      breaker.state = 'HALF_OPEN';

      log('INFO', 'CIRCUIT_HALF_OPEN', { service: serviceKey });
    } else {
      const error = new Error('CIRCUIT_BREAKER_OPEN');
      error.status = 503;
      throw error;
    }
  }

  if (breaker.state === 'HALF_OPEN') {
    if (breaker.probeInProgress) {
      const error = new Error('CIRCUIT_BREAKER_OPEN');
      error.status = 503;
      throw error;
    }

    breaker.probeInProgress = true;
  }
}

function recordSuccess(breaker, serviceKey) {
  const previousState = breaker.state;

  breaker.state = 'CLOSED';
  breaker.failures = 0;
  breaker.openedAt = null;
  breaker.probeInProgress = false;

  if (previousState !== 'CLOSED') {
    log('INFO', 'CIRCUIT_CLOSED', { service: serviceKey });
  }
}

function recordFailure(breaker, serviceKey) {
  breaker.failures++;
  breaker.probeInProgress = false;

  if (
    breaker.state === 'HALF_OPEN' ||
    breaker.failures >= failureThreshold
  ) {
    breaker.state = 'OPEN';
    breaker.openedAt = Date.now();

    log('ERROR', 'CIRCUIT_OPEN', {
      service: serviceKey,
      failures: breaker.failures
    });
  }
}

async function getWithRetry(url) {
  const { serviceKey, breaker } = getBreaker(url);

  checkCircuit(breaker, serviceKey);

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs
    );

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      });

      // 4xx là phản hồi nghiệp vụ, không retry và không tính
      // là lỗi kết nối của upstream.
      if (response.status >= 400 && response.status < 500) {
        recordSuccess(breaker, serviceKey);

        const error = new Error(
          `UPSTREAM_BUSINESS_${response.status}`
        );

        error.status = response.status;
        throw error;
      }

      if (!response.ok) {
        throw new Error(`UPSTREAM_HTTP_${response.status}`);
      }

      const data = await response.json();

      recordSuccess(breaker, serviceKey);

      return data;

    } catch (error) {
      // Không retry lỗi nghiệp vụ 4xx.
      if (error.status >= 400 && error.status < 500) {
        throw error;
      }

      lastError = error;

      if (attempt < retries) {
        await new Promise(resolve =>
          setTimeout(resolve, 150 * (attempt + 1))
        );
      }

    } finally {
      clearTimeout(timer);
    }
  }

  recordFailure(breaker, serviceKey);

  const error = new Error(
    lastError?.name === 'AbortError'
      ? 'UPSTREAM_TIMEOUT'
      : 'UPSTREAM_UNAVAILABLE'
  );

  error.status =
    lastError?.name === 'AbortError' ? 504 : 503;

  throw error;
}

function getCircuitStatus() {
  return Object.fromEntries(
    Array.from(breakers.entries()).map(([service, breaker]) => [
      service,
      {
        state: breaker.state,
        failures: breaker.failures,
        openedAt: breaker.openedAt
      }
    ])
  );
}

module.exports = {
  getWithRetry,
  getCircuitStatus
};
