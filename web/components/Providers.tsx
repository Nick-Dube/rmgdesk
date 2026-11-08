'use client';

import '@aws-amplify/ui-react/styles.css';
import { Amplify } from 'aws-amplify';
import { Authenticator, ThemeProvider, useAuthenticator, type Theme } from '@aws-amplify/ui-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Shell } from './Shell';
import { MeContext } from './MeContext';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID ?? '',
      userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID ?? '',
      loginWith: { email: true },
      signUpVerificationMethod: 'code',
      userAttributes: { email: { required: true }, name: { required: true } },
      mfa: { status: 'on', totpEnabled: true, smsEnabled: true },
      passwordFormat: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSpecialCharacters: false,
      },
    },
  },
});

const theme: Theme = {
  name: 'rmgdesk',
  tokens: {
    colors: {
      brand: {
        primary: {
          10: { value: '#e8eef6' },
          80: { value: '#0b2545' },
          90: { value: '#08182e' },
          100: { value: '#050f1d' },
        },
      },
    },
    radii: { small: { value: '8px' }, medium: { value: '10px' }, large: { value: '14px' } },
  },
};

const formFields = {
  signUp: {
    name: { label: 'Full name', placeholder: 'e.g. Sam Taylor', order: 1 },
    email: { label: 'Work email', placeholder: 'you@rmg.co.uk', order: 2 },
    password: { order: 3 },
    confirm_password: { order: 4 },
  },
  signIn: { username: { label: 'Work email', placeholder: 'you@rmg.co.uk' } },
  // Name shown in the authenticator app (Microsoft Authenticator, Google Authenticator...)
  setupTotp: { QR: { totpIssuer: 'RMG Helpdesk' } },
};

function SignInHeader() {
  return (
    <div className="px-8 pt-8 text-center">
      <img src="/icon.svg" alt="" className="mx-auto h-14 w-14" />
      <h1 className="mt-4 text-xl font-semibold text-[#0b2545]">RMG Helpdesk</h1>
      <p className="mt-1 text-sm text-stone-600">Report and track issues across Royal Museums Greenwich</p>
    </div>
  );
}

function SignInFooter() {
  return (
    <p className="px-8 pb-6 text-center text-xs text-stone-500">
      In an emergency, call Security Control on <strong>6555</strong>. Helpdesk 0208 312 6708.
    </p>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);
  const [me, setMe] = useState<Me['user'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      setMe(null);
      return;
    }
    api<Me>('/me')
      .then((r) => setMe(r.user))
      .catch((e: ApiError) => setError(e.message));
  }, [authStatus]);

  if (authStatus === 'configuring') return null;

  if (authStatus !== 'authenticated') {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f6f7f9] px-4 py-10">
        <Authenticator
          loginMechanisms={['email']}
          signUpAttributes={['name']}
          formFields={formFields}
          components={{ Header: SignInHeader, Footer: SignInFooter }}
        />
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f6f7f9] px-4">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-stone-200">
          <h1 className="text-lg font-semibold text-stone-900">We couldn&apos;t open the helpdesk</h1>
          <p className="mt-2 text-stone-600">{error}</p>
        </div>
      </main>
    );
  }

  if (!me) {
    return <div className="flex min-h-dvh items-center justify-center text-stone-500">Loading…</div>;
  }

  return (
    <MeContext.Provider value={me}>
      <Shell>{children}</Shell>
    </MeContext.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <Authenticator.Provider>
        <Gate>{children}</Gate>
      </Authenticator.Provider>
    </ThemeProvider>
  );
}
