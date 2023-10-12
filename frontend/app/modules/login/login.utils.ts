import { Platform } from 'react-native';
import { DiscoveryDocument, makeRedirectUri } from 'expo-auth-session';
import * as AuthSession from 'expo-auth-session';
import { generateHexStringAsync, buildCodeAsync } from 'expo-auth-session/src/PKCE';
import { buildQueryString } from 'expo-auth-session/src/QueryParams';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import AppConfig from '../../config/app-config';

WebBrowser.maybeCompleteAuthSession();

interface AuthParams {
  state: string;
  codeVerifier: string;
  authUrl: string;
}

export async function getAuthParams(clientId: string, redirectUri: string, discovery: DiscoveryDocument): Promise<AuthParams> {
  const state = await generateHexStringAsync(16);
  const { codeVerifier, codeChallenge } = await buildCodeAsync();
  const authenticationOptions = {
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: ['openid', 'profile', 'email', 'address', 'phone', 'offline_access'].join(' '),
    state,
    client_id: clientId,
    redirect_uri: redirectUri,
    audience: 'api://default',
  };
  const authUrl = `${discovery.discoveryDocument?.authorization_endpoint}?${buildQueryString(authenticationOptions)}`;
  return {
    state,
    codeVerifier,
    authUrl,
  };
}

export async function exchangeCodeForToken(
  clientId: string,
  redirectUri: string,
  discovery: DiscoveryDocument,
  code: string,
  codeVerifier: string,
) {
  return AuthSession.exchangeCodeAsync(
    {
      code,
      clientId,
      redirectUri,
      extraParams: {
        code_verifier: codeVerifier,
      },
    },
    discovery,
  );
}

export function extractCodeOrThrow(result: AuthSession.AuthSessionResult, state: string): string {
  if (result.type === 'success' && result.params && result.params.code && result.params.state === state) {
    return result.params.code;
  } else {
    throw result;
  }
}
export async function getDiscovery(issuer: string): Promise<DiscoveryDocument> {
  return AuthSession.fetchDiscoveryAsync(issuer);
}

export async function doOauthPkceFlow(clientId: string, issuer: string): Promise<AuthSession.TokenResponse> {
  // set up redirect uri
  const redirectUri = makeRedirectUri({ useProxy: AppConfig.useExpoAuthProxy });
  // fetch oauth issuer information from discovery endpoint
  const discovery = await getDiscovery(issuer);
  // set up the IDP url, prepare codeVerifier and state
  const { authUrl, codeVerifier, state } = await getAuthParams(clientId, redirectUri, discovery);
  // redirect to the IDP
  const returnUri = Platform.OS === 'android' && !AppConfig.useExpoAuthProxy ? redirectUri : Linking.createURL('/');
  const authResult = await AuthSession.startAsync({ authUrl, returnUrl: returnUri });
  // check the response for success/failure
  const code = extractCodeOrThrow(authResult, state);
  // exchange the received code for an access token
  return exchangeCodeForToken(clientId, redirectUri, discovery, code, codeVerifier);
}

export async function logoutFromIdp(clientId: string, issuer: string, idToken: string) {
  // logging out of IDP is not supported by the expo auth proxy
  if (!AppConfig.useExpoAuthProxy) {
    const discovery = await getDiscovery(issuer);
    const { endSessionEndpoint } = discovery;
    if (endSessionEndpoint) {
      // set up redirect uri
      const redirectUri = makeRedirectUri({ useProxy: AppConfig.useExpoAuthProxy });
      await WebBrowser.openAuthSessionAsync(
        `${endSessionEndpoint}?id_token_hint=${idToken}&client_id=${clientId}&post_logout_redirect_uri=${redirectUri}`,
        redirectUri,
      );
    } else if (issuer.includes('auth0.com')) {
      // Auth0 need special handling since end_session_endpoint is not in oidc-configuration
      const redirectUri = makeRedirectUri({ useProxy: AppConfig.useExpoAuthProxy });
      await WebBrowser.openAuthSessionAsync(`${issuer}/v2/logout?client_id=${clientId}&returnTo=${redirectUri}`, redirectUri);
    }
  }
}
