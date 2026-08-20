/**
 * Google Identity Services token client.
 *
 * There is no refresh token here, and that is the point: nothing long-lived
 * exists to encrypt, rotate, or leak from a server we do not have. What Google
 * grants is an access token good for one hour.
 *
 * That token is kept — in memory, and in localStorage via `session-store` — so
 * a reload inside the hour needs no round trip at all. Past the hour a silent
 * request renews it, invisibly, as long as the browser still has a Google
 * session and consent was granted once.
 */

const GIS_SRC = "https://accounts.google.com/gsi/client";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type TokenClient = {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
};

type Gis = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        prompt?: string;
        hint?: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string }) => void;
      }) => TokenClient;
      revoke: (token: string, done?: () => void) => void;
    };
  };
};

declare global {
  interface Window {
    google?: Gis;
  }
}

let scriptLoad: Promise<Gis> | null = null;

/** Injects the GIS script once, no matter how many callers ask for it. */
function loadGis(): Promise<Gis> {
  if (scriptLoad) return scriptLoad;

  scriptLoad = new Promise<Gis>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve(window.google);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SRC}"]`,
    );
    const script = existing ?? document.createElement("script");

    script.addEventListener("load", () => {
      if (window.google?.accounts?.oauth2) {
        resolve(window.google);
      } else {
        reject(new Error("Google Identity Services loaded without oauth2."));
      }
    });
    script.addEventListener("error", () =>
      reject(new Error("Could not load Google Identity Services.")),
    );

    if (!existing) {
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  // A failed load must not be cached, or every later attempt inherits it.
  scriptLoad.catch(() => {
    scriptLoad = null;
  });

  return scriptLoad;
}

/** Raised when a silent request needs the user to click something. */
export class ConsentRequired extends Error {
  constructor() {
    super("Google needs the user to grant access explicitly.");
    this.name = "ConsentRequired";
  }
}

export type Token = { value: string; expiresAt: number };

/**
 * Asks Google for an access token.
 *
 * With `silent`, no popup is allowed: if Google cannot answer without asking
 * the user something, this rejects with `ConsentRequired` and the caller shows
 * a sign-in button. That is how a returning visit skips the popup entirely
 * while a first visit still gets a proper consent screen.
 */
export async function requestToken(
  clientId: string,
  { silent, hint }: { silent: boolean; hint?: string | null },
): Promise<Token> {
  const gis = await loadGis();

  return new Promise<Token>((resolve, reject) => {
    // A silent request that Google cannot satisfy sometimes fires neither
    // callback, so the promise would hang forever without this. Fifteen
    // seconds rather than eight: on a slow mobile connection a premature
    // timeout shows the connect button to someone who was already signed in.
    const timeout = silent
      ? setTimeout(() => reject(new ConsentRequired()), 15000)
      : undefined;

    const settle = (outcome: () => void) => {
      if (timeout) clearTimeout(timeout);
      outcome();
    };

    const client = gis.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      // Names the account so Google skips the chooser on renewal.
      ...(hint ? { hint } : {}),
      callback: (response) => {
        if (response.access_token) {
          // Expire a minute early so a call never starts on a dying token.
          const lifetime = (response.expires_in ?? 3600) - 60;
          settle(() =>
            resolve({
              value: response.access_token as string,
              expiresAt: Date.now() + lifetime * 1000,
            }),
          );
          return;
        }
        settle(() =>
          reject(
            silent
              ? new ConsentRequired()
              : new Error(
                  response.error_description ??
                    response.error ??
                    "Google refused the token request.",
                ),
          ),
        );
      },
      error_callback: () => settle(() => reject(new ConsentRequired())),
    });

    // An empty prompt means "ask only if you must", which is right for both
    // paths: silent renewal shows nothing, and a first connect still gets the
    // consent screen. Forcing "consent" would re-ask someone who already said
    // yes, every single time.
    client.requestAccessToken({ prompt: "" });
  });
}

export async function revokeToken(token: string): Promise<void> {
  const gis = await loadGis();
  return new Promise((resolve) => gis.accounts.oauth2.revoke(token, resolve));
}
