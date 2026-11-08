'use strict';
// Cognito pre sign-up trigger. People may register themselves only with an allowed email domain
// (rmg.co.uk, vertex.net). Partners (OCS, Benugo, ...) are invited by an admin instead.

function allowedDomains() {
  return (process.env.SELF_SIGNUP_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedEmail(email, domains = allowedDomains()) {
  const domain = String(email || '').toLowerCase().split('@')[1] || '';
  return domains.includes(domain);
}

exports.isAllowedEmail = isAllowedEmail;

exports.handler = async (event) => {
  // Admin invitations and SSO sign-ins are always allowed; only self sign-up is checked.
  if (event.triggerSource !== 'PreSignUp_SignUp') return event;
  const email = event.request?.userAttributes?.email;
  if (!isAllowedEmail(email)) {
    throw new Error('Self registration is only open to RMG and Vertex email addresses. Please ask the RMG Estates team for an invitation.');
  }
  return event;
};
