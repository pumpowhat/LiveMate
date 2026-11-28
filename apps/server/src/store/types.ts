import type { Comment, CommentVerdict, LiveSession, Order, Product, RiskAlert, Seller } from "@livemate/shared";
import type { FacebookConnectionStore } from "../facebook/store.ts";
import type { LineRef, OrderGateway } from "../pipeline/gateway.ts";
import type { BuyerHistoryStore } from "../risk/history.ts";
import type { OrderActionKind, SessionSummary } from "./transitions.ts";

export interface AuthSessionRecord {
  id: string;
  sellerId: string;
  expiresAt: Date;
}

export interface BuyerCapabilityRecord {
  id: string;
  sessionId: string;
  buyerExternalId: string;
  displayName: string;
}

export interface ProductCreateInput {
  code: string;
  name: string;
  sizes: string[];
  price: number;
  stock: Record<string, number>;
}

export interface ProductPatchInput {
  code?: string;
  name?: string;
  sizes?: string[];
  price?: number;
  stock?: Record<string, number>;
}

export interface OrderTransitionOutcome {
  order: Order;
  previousStatus: Order["status"];
  changed: boolean;
  session: LiveSession;
}

export interface BackendStore {
  readonly gateway: OrderGateway;
  readonly buyerHistory: BuyerHistoryStore;
  readonly facebookStore: FacebookConnectionStore;

  ensureDemoSeed(catalog: Product[]): Promise<{ seller: Seller; session: LiveSession }>;

  // Seller auth
  createSeller(input: { email: string; passwordHash: string; displayName: string }): Promise<Seller>;
  findSellerByEmail(email: string): Promise<(Seller & { passwordHash: string }) | null>;
  findSellerById(id: string): Promise<Seller | null>;
  createAuthSession(sellerId: string, tokenHash: string, expiresAt: Date): Promise<AuthSessionRecord>;
  findAuthSessionByTokenHash(tokenHash: string): Promise<{ session: AuthSessionRecord; seller: Seller } | null>;
  findAuthSessionById(sessionId: string): Promise<{ session: AuthSessionRecord; seller: Seller } | null>;
  deleteAuthSessionByTokenHash(tokenHash: string): Promise<void>;

  // Sessions
  listSessionsBySeller(sellerId: string): Promise<LiveSession[]>;
  createSession(sellerId: string, opts?: { roomCode?: string; seedCatalog?: Product[] }): Promise<LiveSession>;
  getSessionById(sessionId: string): Promise<LiveSession | null>;
  getSessionByRoomCode(roomCode: string): Promise<LiveSession | null>;
  findActiveSessionForSeller(sellerId: string): Promise<LiveSession | null>;
  endSession(sessionId: string): Promise<LiveSession>;
  setFeaturedProduct(sessionId: string, productId: string | null): Promise<{ session: LiveSession; product: Product | null }>;
  setFeaturedProductByCode(sessionId: string, code: string): Promise<{ session: LiveSession; product: Product }>;
  updateSessionFacebook(sessionId: string, facebookObjectId: string | null, facebookPageId: string | null): Promise<LiveSession>;

  // Products
  listProducts(sessionId: string): Promise<Product[]>;
  getProductById(sessionId: string, productId: string): Promise<Product | null>;
  createProduct(sessionId: string, input: ProductCreateInput): Promise<Product>;
  updateProduct(sessionId: string, productId: string, patch: ProductPatchInput): Promise<Product>;
  deleteProduct(sessionId: string, productId: string): Promise<{ sessionUpdated?: LiveSession }>;

  // Comments & Risk
  saveComment(comment: Comment): Promise<void>;
  updateCommentVerdict(commentId: string, verdict: CommentVerdict, orderId?: string): Promise<void>;
  listComments(sessionId: string): Promise<Comment[]>;
  saveRiskAlert(alert: RiskAlert): Promise<void>;
  listRiskAlerts(sessionId: string): Promise<RiskAlert[]>;

  // Buyer capabilities
  joinRoomAsBuyer(
    sessionId: string,
    input: { displayName?: string; buyerToken?: string },
  ): Promise<{ buyerToken: string; capability: BuyerCapabilityRecord; order: Order | null }>;
  resolveBuyerCapability(sessionId: string, buyerToken: string): Promise<BuyerCapabilityRecord | null>;

  // Orders & transitions
  listOrdersBySession(sessionId: string): Promise<Order[]>;
  getOrderById(orderId: string): Promise<Order | null>;
  getOrderByPublicToken(publicToken: string): Promise<Order | null>;
  getSessionSummary(sessionId: string): Promise<SessionSummary>;
  sellerPatchOrderItem(
    sessionId: string,
    orderId: string,
    line: LineRef,
    patch: { productId?: string; size?: string | null; qty?: number },
  ): Promise<Order>;
  transitionOrderById(orderId: string, action: OrderActionKind): Promise<OrderTransitionOutcome>;
  transitionOrderByPublicToken(publicToken: string, action: "report_payment"): Promise<OrderTransitionOutcome>;
}
