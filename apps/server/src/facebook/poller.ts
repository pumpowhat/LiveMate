import type { Comment } from "@livemate/shared";
import { GraphApiError } from "./graph.ts";
import type { FbComment, GraphClient } from "./graph.ts";

const MAX_SEEN = 5_000;
const MAX_BACKOFF_MS = 30_000;

interface CommentPollerOptions {
  client: GraphClient;
  objectId: string;
  pageToken: string;
  sessionId: string;
  intervalMs?: number;
  emitBacklog?: boolean;
  onComment: (comment: Comment) => void | Promise<void>;
  onError?: (error: unknown) => void;
  now?: () => Date;
}

interface PollRun {
  timer?: ReturnType<typeof setInterval>;
  delay: number;
}

export class CommentPoller {
  private readonly seen = new Set<string>();
  private readonly intervalMs: number;
  private readonly now: () => Date;
  private run?: PollRun;
  private polling = false;
  private initialized = false;

  constructor(private readonly options: CommentPollerOptions) {
    this.intervalMs = options.intervalMs ?? 2_000;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.run) return;
    const run: PollRun = { delay: this.intervalMs };
    this.run = run;
    this.schedule(run, this.intervalMs);
    void this.tick(run);
  }

  stop(): void {
    clearInterval(this.run?.timer);
    this.run = undefined;
  }

  private schedule(run: PollRun, delay: number): void {
    clearInterval(run.timer);
    run.delay = delay;
    run.timer = setInterval(() => { void this.tick(run); }, delay);
  }

  private async tick(run: PollRun): Promise<void> {
    if (this.polling || this.run !== run) return;
    this.polling = true;
    try {
      const skipBacklog = !this.initialized && !this.options.emitBacklog;
      const comments = await this.collectNewComments(run, skipBacklog ? MAX_SEEN : Infinity);
      if (this.run !== run) return;
      this.initialized = true;

      for (const comment of comments.reverse()) {
        if (this.run !== run) return;
        if (!skipBacklog) await this.options.onComment(this.toComment(comment));
        this.remember(comment.id);
      }
      if (this.run === run && run.delay !== this.intervalMs) this.schedule(run, this.intervalMs);
    } catch (error) {
      if (this.run !== run) return;
      if (error instanceof GraphApiError && error.isTokenError) {
        this.stop();
      } else {
        this.schedule(run, Math.min(run.delay * 2, MAX_BACKOFF_MS));
      }
      this.options.onError?.(error);
    } finally {
      this.polling = false;
    }
  }

  private async collectNewComments(run: PollRun, limit: number): Promise<FbComment[]> {
    const { client, objectId, pageToken } = this.options;
    const comments = new Map<string, FbComment>();
    const visitedCursors = new Set<string>();
    let after: string | undefined;

    do {
      const { comments: page, nextCursor } = await client.listComments(objectId, pageToken, { after });
      if (this.run !== run) break;
      for (const comment of page) {
        if (this.seen.has(comment.id)) return [...comments.values()];
        if (comments.has(comment.id)) continue;
        comments.set(comment.id, comment);
        if (comments.size === limit) return [...comments.values()];
      }
      if (!nextCursor || visitedCursors.has(nextCursor)) break;
      visitedCursors.add(nextCursor);
      after = nextCursor;
    } while (after);

    return [...comments.values()];
  }

  private remember(id: string): void {
    this.seen.add(id);
    if (this.seen.size > MAX_SEEN) {
      const oldest = this.seen.values().next();
      if (!oldest.done) this.seen.delete(oldest.value);
    }
  }

  private toComment(comment: FbComment): Comment {
    const timestamp = Date.parse(comment.createdTime);
    return {
      id: `fb_${comment.id}`,
      source: "facebook",
      externalId: comment.id,
      buyerExternalId: comment.fromId ?? `fb_anon_${comment.id}`,
      buyerName: comment.fromName ?? "Khách Facebook",
      text: comment.message ?? "",
      createdAt: (Number.isNaN(timestamp) ? this.now() : new Date(timestamp)).toISOString(),
      sessionId: this.options.sessionId,
    };
  }
}

export function fbReplyFor(comment: Comment): string | null {
  return comment.source === "facebook" ? comment.externalId ?? null : null;
}
