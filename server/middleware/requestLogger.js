/**
 * Express middleware that logs every HTTP request with method, path, status, and duration.
 * Writes through the console hooks so it lands in server.log automatically.
 */
export function requestLogger() {
  return (req, res, next) => {
    const start = Date.now();

    // Hook into response finish to capture status code and timing
    res.on('finish', () => {
      const duration = Date.now() - start;
      const status = res.statusCode;
      const tag = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
      const logFn = status >= 500 ? console.error : status >= 400 ? console.warn : console.log;

      logFn(`[http] ${tag} ${req.method} ${req.originalUrl} -> ${status} (${duration}ms)`);
    });

    next();
  };
}
