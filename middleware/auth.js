/**
 * Authentication middleware
 * Checks if user is logged in via session
 */
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.redirect('/login');
}

function isAdmin(req, res, next) {
  if (req.session && req.session.userRole === 'admin') {
    return next();
  }

  res.redirect('/dashboard');
}

module.exports = { isAuthenticated, isAdmin };
