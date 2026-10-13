// Keep the deadline active until the complete JSON response has arrived.
// The task signal still takes precedence when it cancels the request first.
export async function fetchVisionJson(url, init, timeoutMs = 120000) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  try {
    const response = await fetch(url, { ...init, signal });
    const payload = await response.json().catch(error => {
      signal.throwIfAborted();
      if (error.name === 'SyntaxError') return {};
      throw error;
    });
    return { response, payload };
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
}
