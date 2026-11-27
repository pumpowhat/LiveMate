import "dotenv/config";
import { GraphApiError, GraphClient } from "../src/facebook/graph.ts";
import type { FbComment } from "../src/facebook/graph.ts";

const usage = [
  "Cách dùng",
  "  pnpm --filter @livemate/server exec tsx scripts/fb-spike.ts <objectId>",
  "  pnpm --filter @livemate/server exec tsx scripts/fb-spike.ts --live <pageId>",
  '  pnpm --filter @livemate/server exec tsx scripts/fb-spike.ts --reply <commentId> "<nội dung>"',
].join("\n");

async function main(args: string[]): Promise<void> {
  const [target, id, message] = args;
  const isLive = target === "--live";
  const isReply = target === "--reply";
  const expectedArgs = isReply ? 3 : isLive ? 2 : 1;
  const objectId = isLive || isReply ? id : target;
  if (!objectId || objectId.startsWith("-") || args.length !== expectedArgs || (isReply && !message?.trim())) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }

  const graphVersion = process.env.FB_GRAPH_VERSION?.trim();
  const pageToken = process.env.FB_PAGE_TOKEN?.trim();
  if (!graphVersion || !pageToken) {
    const missing = [!graphVersion && "FB_GRAPH_VERSION", !pageToken && "FB_PAGE_TOKEN"].filter(Boolean);
    console.error(`Thiếu biến môi trường ${missing.join(", ")}. Hãy đặt biến còn thiếu rồi chạy lại.`);
    process.exitCode = 1;
    return;
  }

  const client = new GraphClient({ graphVersion });
  if (isLive) {
    const videos = await client.getPageLiveVideos(objectId, pageToken);
    console.table(videos.map(({ id, status, title, video, creation_time }) => ({
      id,
      "Trạng thái": status,
      "Tiêu đề": title ?? "—",
      videoId: video?.id ?? "—",
      "Thời gian tạo": creation_time ?? "—",
    })));
    return;
  }
  if (isReply && message) {
    const replyId = await client.replyToComment(objectId, message, pageToken);
    console.log(`Đã gửi bình luận trả lời (ID ${replyId}).`);
    return;
  }

  const sample = new Map<string, FbComment>();
  const visitedCursors = new Set<string>();
  let after: string | undefined;
  do {
    const { comments, nextCursor } = await client.listComments(objectId, pageToken, {
      limit: 25 - sample.size,
      after,
    });
    for (const comment of comments) {
      sample.set(comment.id, comment);
      if (sample.size === 25) break;
    }
    if (sample.size === 25 || !nextCursor || visitedCursors.has(nextCursor)) break;
    visitedCursors.add(nextCursor);
    after = nextCursor;
  } while (after);

  const comments = [...sample.values()];
  console.table(comments.map(({ createdTime, fromId, fromName, message }) => ({
    "Thời gian": createdTime,
    fromId: fromId ?? "—",
    fromName: fromName ?? "— (không có from)",
    "Nội dung": message,
  })));

  const withFrom = comments.filter(({ fromId, fromName }) => fromId !== null || fromName !== null).length;
  const withName = comments.filter(({ fromName }) => fromName !== null).length;
  console.log(`Có from: ${withFrom}. Không có from: ${comments.length - withFrom}.`);
  if (comments.length === 0) {
    console.log("Kết luận: Chưa có bình luận để kiểm tra.");
  } else {
    console.log(
      `Kết luận: Graph API trả về tên cho ${withName}/${comments.length} bình luận trong mẫu. `
      + "Hãy đối chiếu với bình luận của tài khoản đã xác nhận không có vai trò trong app.",
    );
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof GraphApiError && error.isTokenError) {
    console.error("Facebook từ chối token (mã 190). FB_PAGE_TOKEN có thể đã hết hạn hoặc không hợp lệ.");
  } else if (error instanceof GraphApiError && (error.code === 10 || error.code === 200)) {
    console.error(`Ứng dụng hoặc token Trang thiếu quyền thực hiện thao tác này (mã ${error.code}).`);
  } else if (error instanceof GraphApiError && error.code !== undefined) {
    console.error(`Yêu cầu Graph API thất bại (mã ${error.code}).`);
  } else {
    console.error("Không lấy được phản hồi hợp lệ từ Graph API. Hãy kiểm tra kết nối và thử lại.");
  }
  process.exitCode = 1;
}
