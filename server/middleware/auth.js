/**
 * Express middleware that requires an authenticated session.
 * Returns 401 if no valid session is attached to the request.
 *
 * Must be used AFTER sessionMiddleware so that req.session is populated.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireAuth(req, res, next) {
  if (!req.session || !req.session.tokens) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please sign in with your Google account to access this resource.',
    });
  }
  next();
}
