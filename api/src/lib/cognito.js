'use strict';
// The Cognito calls the admin console makes. Kept behind one object so tests can replace them.
// The "username" passed in is the user's Cognito sub once they have signed in, or their email before
// (the pool signs people in by email, so either identifies them).

const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUserGlobalSignOutCommand,
  AdminSetUserMFAPreferenceCommand,
  AdminUpdateUserAttributesCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

let client;
const cip = () => (client ||= new CognitoIdentityProviderClient({}));
const pool = () => {
  if (!process.env.USER_POOL_ID) throw new Error('USER_POOL_ID is not set');
  return process.env.USER_POOL_ID;
};

/** A Cognito "user not found" is fine for some actions (e.g. offboarding someone who never signed up). */
const notFound = (err) => err && (err.name === 'UserNotFoundException' || err.__type === 'UserNotFoundException');

const cognito = {
  /** Create the login and email the temporary password (Cognito's invitation email). */
  async invite({ email, fullName }) {
    const res = await cip().send(
      new AdminCreateUserCommand({
        UserPoolId: pool(),
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: fullName },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );
    return { sub: (res.User?.Attributes || []).find((a) => a.Name === 'sub')?.Value || null };
  },

  /** Send the invitation again with a new temporary password (only before their first sign-in). */
  async resendInvite({ email }) {
    await cip().send(new AdminCreateUserCommand({ UserPoolId: pool(), Username: email, MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'] }));
  },

  async disable(username) {
    try {
      await cip().send(new AdminDisableUserCommand({ UserPoolId: pool(), Username: username }));
      await cip().send(new AdminUserGlobalSignOutCommand({ UserPoolId: pool(), Username: username }));
    } catch (err) {
      if (!notFound(err)) throw err;
    }
  },

  async enable(username) {
    try {
      await cip().send(new AdminEnableUserCommand({ UserPoolId: pool(), Username: username }));
    } catch (err) {
      if (!notFound(err)) throw err;
    }
  },

  /** Clear their authenticator app and SMS preference: they set MFA up again at the next sign-in. */
  async resetMfa(username) {
    await cip().send(
      new AdminSetUserMFAPreferenceCommand({
        UserPoolId: pool(),
        Username: username,
        SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false },
        SMSMfaSettings: { Enabled: false, PreferredMfa: false },
      }),
    );
    await cip().send(new AdminUserGlobalSignOutCommand({ UserPoolId: pool(), Username: username }));
  },

  async updateName(username, fullName) {
    try {
      await cip().send(new AdminUpdateUserAttributesCommand({ UserPoolId: pool(), Username: username, UserAttributes: [{ Name: 'name', Value: fullName }] }));
    } catch (err) {
      if (!notFound(err)) throw err;
    }
  },
};

module.exports = { cognito, notFound };
