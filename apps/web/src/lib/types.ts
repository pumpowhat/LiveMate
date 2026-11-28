import type {
  ClientToServerEvents,
  Comment,
  CommentVerdict,
  LiveSession,
  Order,
  OrderStatus,
  Product,
  RiskAlert,
  RiskKind,
  Seller,
  ServerToClientEvents,
  SocketAck,
} from "@livemate/shared";

export type {
  Buyer,
  ClientToServerEvents,
  Comment,
  CommentSource,
  CommentVerdict,
  LiveSession,
  Order,
  OrderItem,
  OrderStatus,
  Product,
  RiskAlert,
  RiskKind,
  Seller,
  ServerToClientEvents,
  SocketAck,
} from "@livemate/shared";
export { buyerRoom, orderRoom, sellerRoom } from "@livemate/shared";

export interface SessionDetail {
  session: LiveSession;
  catalog: Product[];
  orders: Order[];
  comments: Comment[];
}

export interface TopProductSummary {
  productCode: string;
  productName: string;
  qty: number;
  revenue: number;
}

export interface SessionSummary {
  session: LiveSession;
  revenue: number;
  counts: Partial<Record<OrderStatus, number>>;
  pendingOrders: Order[];
  topProducts: TopProductSummary[];
}

export interface ProductInput {
  code: string;
  name: string;
  sizes: string[];
  price: number;
  stock: Record<string, number>;
}

export interface OrderLinePatch {
  line: { productId: string; size: string | null };
  patch: { productId?: string; size?: string | null; qty?: number };
}

export interface PublicRoomResponse {
  session: LiveSession;
  featuredProduct: Product | null;
  comments: Comment[];
}

export interface JoinRoomResponse {
  buyerToken: string;
  order: Order | null;
}

export interface FacebookPageSummary {
  id: string;
  name: string;
}

export interface FacebookStatusResponse {
  connected: boolean;
  pages: FacebookPageSummary[];
  selectedPage: FacebookPageSummary | null;
}

export interface FacebookLiveVideo {
  id: string;
  title?: string;
  description?: string;
  status: string;
  permalink_url?: string;
}

export type ReplyEvent = Parameters<ServerToClientEvents["reply:new"]>[0];
export type CommentVerdictEvent = Parameters<ServerToClientEvents["comment:verdict"]>[0];
export type ProductFeaturedEvent = Parameters<ServerToClientEvents["product:featured"]>[0];

export type RiskKindLabel = RiskKind;
