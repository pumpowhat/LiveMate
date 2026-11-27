interface GraphErrorDetails {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export class GraphApiError extends Error {
  readonly code: number | undefined;
  readonly subcode: number | undefined;
  readonly type: string | undefined;
  readonly fbtraceId: string | undefined;

  constructor(details: GraphErrorDetails) {
    super(details.message);
    this.name = "GraphApiError";
    this.code = details.code;
    this.subcode = details.error_subcode;
    this.type = details.type;
    this.fbtraceId = details.fbtrace_id;
  }

  get isTokenError(): boolean {
    return this.code === 190;
  }
}

export interface FbComment {
  id: string;
  message: string;
  createdTime: string;
  fromId: string | null;
  fromName: string | null;
}

interface GraphComment {
  id: string;
  message?: string | null;
  created_time: string;
  from?: { id?: string; name?: string } | null;
}

export interface FbLiveVideo {
  id: string;
  status: string;
  title?: string;
  video?: { id: string };
  creation_time?: string;
}

export interface GraphPage<T> {
  data: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

type GraphParams = Record<string, string | number | boolean | undefined>;

export class GraphClient {
  private readonly fetchImpl: typeof fetch;
  private readonly graphVersion: string;

  constructor({ graphVersion, fetchImpl = fetch }: { graphVersion: string; fetchImpl?: typeof fetch }) {
    this.graphVersion = graphVersion;
    this.fetchImpl = fetchImpl;
  }

  getJson<T>(path: string, params: GraphParams, token?: string): Promise<T> {
    const url = this.endpoint(path);
    url.search = this.formParams(params, token).toString();
    return this.request<T>(url, { method: "GET" });
  }

  postForm<T>(path: string, params: GraphParams, token: string): Promise<T> {
    return this.request<T>(this.endpoint(path), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: this.formParams(params, token),
    });
  }

  async listComments(
    objectId: string,
    token: string,
    { limit = 50, after }: { limit?: number; after?: string } = {},
  ): Promise<{ comments: FbComment[]; nextCursor?: string }> {
    const { data, paging } = await this.getJson<GraphPage<GraphComment>>(
      `${encodeURIComponent(objectId)}/comments`,
      {
        fields: "id,message,created_time,from{id,name}",
        order: "reverse_chronological",
        filter: "stream",
        limit,
        after,
      },
      token,
    );
    const comments = data.map((comment) => ({
      id: comment.id,
      message: comment.message ?? "",
      createdTime: comment.created_time,
      fromId: comment.from?.id ?? null,
      fromName: comment.from?.name ?? null,
    }));
    const nextCursor = paging?.next ? paging.cursors?.after : undefined;
    return nextCursor ? { comments, nextCursor } : { comments };
  }

  async replyToComment(commentId: string, message: string, token: string): Promise<string> {
    const { id } = await this.postForm<{ id: string }>(
      `${encodeURIComponent(commentId)}/comments`,
      { message },
      token,
    );
    return id;
  }

  async getPageLiveVideos(pageId: string, token: string): Promise<FbLiveVideo[]> {
    const { data } = await this.getJson<GraphPage<FbLiveVideo>>(
      `${encodeURIComponent(pageId)}/live_videos`,
      { fields: "id,status,title,video{id},creation_time", limit: 10 },
      token,
    );
    return data;
  }

  private endpoint(path: string): URL {
    const url = new URL("https://graph.facebook.com");
    url.pathname = `/${encodeURIComponent(this.graphVersion)}/${path.replace(/^\/+/, "")}`;
    return url;
  }

  private formParams(params: GraphParams, token?: string): URLSearchParams {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) form.set(key, String(value));
    }
    if (token !== undefined) form.set("access_token", token);
    return form;
  }

  private async request<T>(url: URL, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(url, { ...init, redirect: "error" });
    const payload = await response.json().catch(() => {
      if (response.ok) throw new Error("Facebook Graph API returned invalid JSON");
      return null;
    }) as { error?: GraphErrorDetails } | null;
    if (payload?.error) throw new GraphApiError(payload.error);
    if (!response.ok) throw new GraphApiError({ message: `Facebook Graph API HTTP ${response.status}` });
    return payload as T;
  }
}
