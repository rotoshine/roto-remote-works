import type {
  ApplyOrigin,
  ApplyRequest,
  Comment,
  CommentPatch,
  NewComment,
  Question,
  Status,
  StatusPatch,
} from "./types";

export interface ClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

export interface BridgeClient {
  listComments(): Promise<Comment[]>;
  addComment(input: NewComment): Promise<Comment>;
  patchComment(id: string, patch: CommentPatch): Promise<Comment>;
  deleteComment(id: string): Promise<void>;
  clearComments(): Promise<void>;
  apply(origin: ApplyOrigin): Promise<ApplyRequest>;
  getStatus(): Promise<Status>;
  setStatus(patch: StatusPatch): Promise<Status>;
  getQuestion(): Promise<Question | null>;
  currentQuestion(): Promise<Question | null>;
  answer(id: string, value: string): Promise<Question>;
  cancel(id: string): Promise<Question>;
}

export function createClient(opts: ClientOptions): BridgeClient {
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
    addComment: (input) => request<Comment>("POST", "/comments", input),
    patchComment: (id, patch) => request<Comment>("PATCH", `/comments/${id}`, patch),
    deleteComment: async (id) => {
      await request("DELETE", `/comments/${id}`);
    },
    clearComments: async () => {
      await request("DELETE", "/comments");
    },
    apply: (origin) => request<ApplyRequest>("POST", "/apply", { origin }),
    getStatus: () => request<Status>("GET", "/status"),
    setStatus: (patch) => request<Status>("PATCH", "/status", patch),
    getQuestion: () => request<Question | null>("GET", "/question"),
    currentQuestion: () => request<Question | null>("GET", "/question/current"),
    answer: (id, value) => request<Question>("POST", `/question/${id}/answer`, { answer: value }),
    cancel: (id) => request<Question>("POST", `/question/${id}/cancel`),
  };
}
