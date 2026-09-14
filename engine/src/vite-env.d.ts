/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  google?: {
    accounts: {
      oauth2: {
        initTokenClient: (cfg: {
          client_id: string;
          scope: string;
          callback: (resp: { access_token?: string; error?: string; expires_in?: number }) => void;
        }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
        revoke: (token: string, done: () => void) => void;
      };
    };
  };
}
