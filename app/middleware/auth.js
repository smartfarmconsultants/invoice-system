function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  if (req.session.mustChangePassword && req.path !== '/change-password') {
    return res.redirect('/change-password');
  }
  next();
}

// Usage: requireRole('admin') or requireRole('admin', 'manager')
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.redirect('/login');
    }
    if (!allowedRoles.includes(req.session.role)) {
      return res.status(403).render('error', {
        message: 'You do not have permission to access this page.'
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
