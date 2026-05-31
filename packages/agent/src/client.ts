import type {
  ApplyRequest,
  Comment,
  CommentStatus,
  Question,
  Status,
  StatusPatch,
} from "@rrw/bridge";

export interface AgentClient {
  listComments(): Promise<Comment[]>;
  patchComment(id: string, patch: { status?: CommentStatus }): Promise<Comment>;
  getRequest(): Promise<ApplyRequest | null>;
  clearRequest(): Promise<void>;
  setStatus(patch: StatusPatch): Promise<Status>;
  postQuestion(input: { text: string; options?: string[] }): Promise<Question>;
  currentQuestion(): Promise<Question | null>;
  cancelQuestion(id: string): Promise<Question | null>;
  getScreenshot(id: string): Promise<Uint8Array | null>;
}

export interface AgentClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

export function createAgentClient(opts: AgentClientOptions): AgentClient {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const base = opts.baseUrl.replace(/\/$/, "");

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${opts.token}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetchFn(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`bridge ${method} ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    listComments: () => request<Comment[]>("GET", "/comments"),
    patchComment: (id, patch) => request<Comment>("PATCH", `/comments/${id}`, patch),
    getRequest: () => request<ApplyRequest | null>("GET", "/request"),
    clearRequest: async () => {
      await request("DELETE", "/request");
    },
    setStatus: (patch) => request<Status>("PATCH", "/status", patch),
    postQuestion: (input) => request<Question>("POST", "/question", input),
    currentQuestion: () => request<Question | null>("GET", "/question/current"),
    cancelQuestion: (id) => request<Question | null>("POST", `/question/${id}/cancel`),
    getScreenshot: async (id) => {
      const res = await fetchFn(`${base}/comments/${id}/screenshot`, {
        headers: { authorization: `Bearer ${opts.token}` },
      });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
