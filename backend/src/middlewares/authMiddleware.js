const { authenticateSession, configureSessionAuthentication } = require('../security/sessionAuth');

exports.configureAuthentication = ({ mode, sessionRegistry, policyVersion }) => {
  if (mode !== 'oidc') throw new TypeError('C4G authentication requires OIDC.');
  configureSessionAuthentication({ sessionRegistry, policyVersion });
};

exports.createCredentialGuard = () => (req, res, next) => {
  if (req.headers.authorization) return res.status(400).json({ code: 'BEARER_NOT_ALLOWED', message: 'Bearer não é aceite; use a sessão OIDC.' });
  return next();
};

exports.authenticate = async (req, res, next) => {
  if (await authenticateSession(req, res, next)) return;
  return res.status(401).json({ code: 'SESSION_REQUIRED', message: 'Sessão válida necessária.' });
};
