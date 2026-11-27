import { randomBytes } from "node:crypto";
import { GraphClient } from "./graph.ts";
import type { GraphPage } from "./graph.ts";

const PAGE_SCOPES = "pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_engagement";
const STATE_TTL_MS = 10 * 60_000;

interface FacebookLoginConfig {
  graphVersion: string;
  appId: string;
  redirectUri: string;
}

interface FacebookOAuthConfig extends FacebookLoginConfig {
  appSecret: string;
  fetchImpl?: typeof fetch;
}

interface GraphAccount {
  id: string;
  name: string;
  access_token: string;
  tasks: string[];
}

export interface FbPage {
  id: string;
  name: string;
  accessToken: string;
  tasks: string[];
}

export function buildLoginUrl({
  appId, redirectUri, graphVersion, state,
}: FacebookLoginConfig & { state: string }): string {
  const url = new URL("https://www.facebook.com");
  url.pathname = `/${encodeURIComponent(graphVersion)}/dialog/oauth`;
  url.search = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: PAGE_SCOPES,
  }).toString();
  return url.toString();
}

export function createFacebookOAuth({ appId, appSecret, redirectUri, graphVersion, fetchImpl }: FacebookOAuthConfig) {
  const client = new GraphClient({ graphVersion, fetchImpl });
  const appParams = { client_id: appId, client_secret: appSecret };

  return {
    async exchangeCode(code: string): Promise<string> {
      const { access_token } = await client.getJson<{ access_token: string }>("/oauth/access_token", {
        ...appParams,
        redirect_uri: redirectUri,
        code,
      });
      return access_token;
    },

    async toLongLived(userToken: string): Promise<string> {
      const { access_token } = await client.getJson<{ access_token: string }>("/oauth/access_token", {
        ...appParams,
        grant_type: "fb_exchange_token",
        fb_exchange_token: userToken,
      });
      return access_token;
    },

    /** Pass a long-lived user token to obtain long-lived Page tokens. */
    async listPages(userToken: string): Promise<FbPage[]> {
      const pages: FbPage[] = [];
      const visitedCursors = new Set<string>();
      let after: string | undefined;

      do {
        const { data, paging } = await client.getJson<GraphPage<GraphAccount>>(
          "/me/accounts",
          { fields: "id,name,access_token,tasks", after },
          userToken,
        );
        for (const { id, name, access_token, tasks } of data) {
          pages.push({ id, name, accessToken: access_token, tasks });
        }
        after = paging?.next ? paging.cursors?.after : undefined;
        if (!after || visitedCursors.has(after)) break;
        visitedCursors.add(after);
      } while (after);

      return pages;
    },
  };
}

export function createStateStore() {
  const states = new Map<string, { sellerId: string; expiresAt: number }>();

  return {
    issue(sellerId: string): string {
      const now = Date.now();
      for (const [state, { expiresAt }] of states) {
        if (expiresAt <= now) states.delete(state);
      }
      const state = randomBytes(32).toString("base64url");
      states.set(state, { sellerId, expiresAt: now + STATE_TTL_MS });
      return state;
    },

    consume(state: string): string | null {
      const entry = states.get(state);
      states.delete(state);
      return entry && entry.expiresAt > Date.now() ? entry.sellerId : null;
    },
  };
}
