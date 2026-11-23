const timeoutMs = Number(process.env.HTTP_TIMEOUT_MS || 2500);
const retries = Math.max(
  0,
  Number.parseInt(process.env.HTTP_RETRIES || '1', 10) || 0
);

async function getWithRetry(url) {
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

      if (response.status >= 400 && response.status < 500) {
        const error = new Error(
          `UPSTREAM_BUSINESS_${response.status}`
        );

        error.status = response.status;
        throw error;
      }

      if (!response.ok) {
        throw new Error(`UPSTREAM_HTTP_${response.status}`);
      }

      return await response.json();

    } catch (error) {
      lastError = error;

      // Không retry lỗi nghiệp vụ 4xx.
      if (error.status >= 400 && error.status < 500) {
        throw error;
      }

      if (attempt < retries) {
        await new Promise(resolve =>
          setTimeout(resolve, 150 * (attempt + 1))
        );
      }

    } finally {
      clearTimeout(timer);
    }
  }

  const error = new Error(
    lastError?.name === 'AbortError'
      ? 'UPSTREAM_TIMEOUT'
      : 'UPSTREAM_UNAVAILABLE'
  );

  error.status =
    lastError?.name === 'AbortError' ? 504 : 503;

  throw error;
}

module.exports = {
  getWithRetry
};