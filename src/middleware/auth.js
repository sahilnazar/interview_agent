export function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.redirect("/login/admin");
}

export function requireCandidate(req, res, next) {
  if (req.session && req.session.candidate) return next();
  res.redirect("/login/candidate");
}
