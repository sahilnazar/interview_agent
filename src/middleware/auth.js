export function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.redirect("/login/admin");
}

export function requireCandidate(req, res, next) {
  if (!req.session || !req.session.candidate) return res.redirect("/login/candidate");
  // Force password change before accessing any other page
  if (req.session.candidate.mustChangePassword && req.path !== "/change-password") {
    return res.redirect("/candidate/change-password");
  }
  next();
}

export function requireInterviewer(req, res, next) {
  if (req.session && req.session.interviewer) return next();
  res.redirect("/interviewer/login");
}
