import { describe, expect, it } from "vitest";
import { formatVnd, ORDER_STATUS_META, RISK_KIND_LABELS, VERDICT_META } from "../format";

describe("format helpers", () => {
  it("formats VND currency without decimals", () => {
    const out = formatVnd(250000);
    expect(out).toContain("250");
  });

  it("provides Vietnamese labels for all order statuses, verdicts, and risk kinds", () => {
    expect(ORDER_STATUS_META.pending_payment.label).toBe("Chờ thanh toán");
    expect(ORDER_STATUS_META.awaiting_confirmation.label).toBe("Chờ đối soát");
    expect(ORDER_STATUS_META.paid.label).toBe("Đã thanh toán");
    expect(ORDER_STATUS_META.delivered.label).toBe("Đã giao");
    expect(ORDER_STATUS_META.cancelled.label).toBe("Đã hủy");

    expect(VERDICT_META.create.label).toBe("Chốt đơn");
    expect(RISK_KIND_LABELS.buyer_history_boom).toBe("Lịch sử boom đơn");
  });
});
