import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  OAUTH_SCOPE_DISCLOSURES,
  decideAuthorization,
  loadConsentState,
  type ConsentDetails,
} from './authorization.ts';
import { agentAuthEntryRouteFrom } from './entry-route.ts';
import { BOGA_PUBLIC_MCP_ENDPOINT } from './setup.ts';
import './styles.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Application root is missing.');

let client: SupabaseClient | null = null;

const getClient = (): SupabaseClient => {
  if (client) return client;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey) {
    throw new Error('BoGa authorization is not configured.');
  }
  client = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });
  return client;
};

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character] ?? character,
  );

const pageShell = (content: string): string => `
  <section class="consent-shell">
    <header class="brand" aria-label="BoGa">
      <span class="brand-mark" aria-hidden="true">B</span>
      <span>BoGa</span>
    </header>
    ${content}
    <p class="security-note">Authorization is handled securely by BoGa. Your password is never shared with the agent.</p>
  </section>
`;

const renderStatus = (message: string): void => {
  root.innerHTML = pageShell(`
    <div class="status-card" role="status">
      <span class="spinner" aria-hidden="true"></span>
      <p>${escapeHtml(message)}</p>
    </div>
  `);
};

const renderError = (message: string): void => {
  root.innerHTML = pageShell(`
    <div class="consent-card">
      <p class="eyebrow">Connection unavailable</p>
      <h1>We couldn’t continue</h1>
      <p class="lede">${escapeHtml(message)}</p>
      <p class="help">Return to your agent and start the connection again.</p>
    </div>
  `);
};

const renderSetup = (): void => {
  root.innerHTML = pageShell(`
    <div class="consent-card setup-card">
      <p class="eyebrow">AI coach setup</p>
      <h1>Connect BoGa to your AI coach</h1>
      <p class="lede">Use an MCP-compatible client to give your coach read-only access to your training history.</p>

      <div class="endpoint-panel">
        <p class="permission-title">BoGa MCP server</p>
        <code>${escapeHtml(BOGA_PUBLIC_MCP_ENDPOINT)}</code>
      </div>

      <ol class="setup-steps">
        <li><strong>Add the server address</strong> to your MCP client as a remote HTTP connection.</li>
        <li><strong>Choose Connect or Auth in the client.</strong> Your client starts OAuth and opens BoGa in the browser.</li>
        <li><strong>Sign in and review access.</strong> Only approve the client you intended to connect.</li>
      </ol>

      <div class="denied-panel">
        <span class="denied-icon" aria-hidden="true">✓</span>
        <p><strong>Your coach can only read training data.</strong> It cannot create, edit, or delete your workouts, exercises, or sets.</p>
      </div>
      <p class="revoke-note">To disconnect later, open BoGa → Settings → Connected agents and revoke the connection.</p>
    </div>
  `);
};

const renderSignIn = (authorizationId: string, errorMessage = ''): void => {
  root.innerHTML = pageShell(`
    <div class="consent-card">
      <p class="eyebrow">Agent connection</p>
      <h1>Sign in to BoGa</h1>
      <p class="lede">Confirm your account before choosing whether to grant read-only training access.</p>
      <form id="sign-in-form" class="form-stack">
        <label>
          <span>Email</span>
          <input name="email" type="email" autocomplete="email" required />
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <p id="form-error" class="form-error" ${errorMessage ? '' : 'hidden'}>${escapeHtml(errorMessage)}</p>
        <button class="primary-button" type="submit">Continue</button>
      </form>
    </div>
  `);
  const form = document.querySelector<HTMLFormElement>('#sign-in-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(form);
    const email = String(fields.get('email') ?? '').trim();
    const password = String(fields.get('password') ?? '');
    const button = form.querySelector<HTMLButtonElement>('button');
    if (button) button.disabled = true;
    const { error } = await getClient().auth.signInWithPassword({ email, password });
    if (error) {
      renderSignIn(authorizationId, 'The email or password was not accepted.');
      return;
    }
    await showConsent(authorizationId);
  });
};

const renderConsent = (details: ConsentDetails): void => {
  const identityPermissions = details.scopes
    .map(
      (scope) =>
        `<li><strong>${escapeHtml(scope)}</strong> — ${escapeHtml(OAUTH_SCOPE_DISCLOSURES[scope])}</li>`,
    )
    .join('');
  root.innerHTML = pageShell(`
    <div class="consent-card">
      <p class="eyebrow">Read-only coaching access</p>
      <h1>Connect ${escapeHtml(details.clientName)}?</h1>
      <p class="lede">This agent will be able to read the training data you choose to keep in BoGa.</p>
      <div class="permission-panel">
        <p class="permission-title">It can read</p>
        <ul>
          <li>Your training units, gyms, and available equipment</li>
          <li>Your exercise library and muscle mappings</li>
          <li>Your recent workouts, exercise history, and personal records</li>
        </ul>
        <p class="permission-title identity-permission-title">Identity permissions requested</p>
        <ul>${identityPermissions}</ul>
      </div>
      <div class="denied-panel">
        <span class="denied-icon" aria-hidden="true">×</span>
        <p><strong>It cannot change BoGa.</strong> The connection cannot create, edit, or delete workouts, exercises, or sets.</p>
      </div>
      <div class="button-row">
        <button id="deny-button" class="secondary-button" type="button">Cancel</button>
        <button id="approve-button" class="primary-button" type="button">Allow read-only access</button>
      </div>
      <p class="revoke-note">You can revoke this connection at any time from Settings → Connected agents.</p>
    </div>
  `);
  const decide = async (decision: 'approve' | 'deny') => {
    const buttons = root.querySelectorAll<HTMLButtonElement>('button');
    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      const redirectUrl = await decideAuthorization(
        getClient(),
        details.authorizationId,
        decision,
      );
      window.location.assign(redirectUrl);
    } catch (error) {
      renderError(error instanceof Error ? error.message : 'Authorization failed.');
    }
  };
  document.querySelector('#approve-button')?.addEventListener('click', () => {
    void decide('approve');
  });
  document.querySelector('#deny-button')?.addEventListener('click', () => {
    void decide('deny');
  });
};

const showConsent = async (authorizationId: string): Promise<void> => {
  renderStatus('Loading connection details…');
  try {
    const state = await loadConsentState(getClient(), authorizationId);
    if (state.kind === 'redirect') {
      window.location.assign(state.redirectUrl);
      return;
    }
    renderConsent(state.details);
  } catch (error) {
    renderError(error instanceof Error ? error.message : 'Authorization request failed.');
  }
};

const start = async (): Promise<void> => {
  let entryRoute;
  try {
    entryRoute = agentAuthEntryRouteFrom(new URL(window.location.href));
  } catch (error) {
    renderError(error instanceof Error ? error.message : 'Authorization request failed.');
    return;
  }

  if (entryRoute.kind === 'setup') {
    renderSetup();
    return;
  }
  if (entryRoute.kind === 'unsupported') {
    renderError('This page does not exist.');
    return;
  }

  let consentClient: SupabaseClient;
  try {
    consentClient = getClient();
  } catch (error) {
    renderError(error instanceof Error ? error.message : 'Authorization request failed.');
    return;
  }

  const { data, error } = await consentClient.auth.getSession();
  if (error || !data.session) {
    renderSignIn(entryRoute.authorizationId);
    return;
  }
  await showConsent(entryRoute.authorizationId);
};

renderStatus('Preparing a secure connection…');
void start();
