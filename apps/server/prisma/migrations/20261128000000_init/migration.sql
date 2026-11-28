-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('live', 'ended');

-- CreateEnum
CREATE TYPE "CommentSource" AS ENUM ('facebook', 'room', 'extension');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending_payment', 'awaiting_confirmation', 'paid', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "CommentVerdict" AS ENUM ('ignored', 'queued', 'create', 'update', 'cancel', 'ask', 'unparsed');

-- CreateEnum
CREATE TYPE "RiskKind" AS ENUM ('buyer_history_boom', 'unusual_quantity', 'payment_not_found', 'out_of_stock');

-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('info', 'warning', 'danger');

-- CreateTable
CREATE TABLE "Seller" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacebookConnection" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "userToken" TEXT NOT NULL,
    "pages" JSONB NOT NULL,
    "selectedPageId" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacebookConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "roomCode" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'live',
    "featuredProductId" TEXT,
    "previouslyFeatured" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "facebookObjectId" TEXT,
    "facebookPageId" TEXT,
    "nextOrderSeq" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sizes" TEXT[],
    "price" INTEGER NOT NULL,
    "stock" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "source" "CommentSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerCapability" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "buyerExternalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending_payment',
    "total" INTEGER NOT NULL DEFAULT 0,
    "publicToken" TEXT NOT NULL,
    "sourceCommentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sellerEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "size" TEXT,
    "qty" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "source" "CommentSource" NOT NULL,
    "externalId" TEXT,
    "buyerExternalId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "verdict" "CommentVerdict",
    "verdictOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAlert" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "orderId" TEXT,
    "buyerExternalId" TEXT NOT NULL,
    "kind" "RiskKind" NOT NULL,
    "severity" "RiskSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerHistory" (
    "buyerExternalId" TEXT NOT NULL,
    "boomed" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerHistory_pkey" PRIMARY KEY ("buyerExternalId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Seller_email_key" ON "Seller"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_sellerId_idx" ON "AuthSession"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "FacebookConnection_sellerId_key" ON "FacebookConnection"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveSession_roomCode_key" ON "LiveSession"("roomCode");

-- CreateIndex
CREATE INDEX "LiveSession_sellerId_startedAt_idx" ON "LiveSession"("sellerId", "startedAt");

-- CreateIndex
CREATE INDEX "Product_sessionId_createdAt_idx" ON "Product"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sessionId_code_key" ON "Product"("sessionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Buyer_sessionId_externalId_key" ON "Buyer"("sessionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerCapability_tokenHash_key" ON "BuyerCapability"("tokenHash");

-- CreateIndex
CREATE INDEX "BuyerCapability_sessionId_buyerExternalId_idx" ON "BuyerCapability"("sessionId", "buyerExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_publicToken_key" ON "Order"("publicToken");

-- CreateIndex
CREATE INDEX "Order_sessionId_createdAt_idx" ON "Order"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_sessionId_buyerId_idx" ON "Order"("sessionId", "buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_sessionId_code_key" ON "Order"("sessionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Order_one_open_per_buyer_idx" ON "Order"("sessionId", "buyerId") WHERE "status" IN ('pending_payment', 'awaiting_confirmation');

-- CreateIndex
CREATE INDEX "OrderItem_orderId_sortOrder_idx" ON "OrderItem"("orderId", "sortOrder");

-- CreateIndex
CREATE INDEX "Comment_sessionId_createdAt_idx" ON "Comment"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskAlert_sessionId_createdAt_idx" ON "RiskAlert"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacebookConnection" ADD CONSTRAINT "FacebookConnection_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Buyer" ADD CONSTRAINT "Buyer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerCapability" ADD CONSTRAINT "BuyerCapability_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAlert" ADD CONSTRAINT "RiskAlert_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
