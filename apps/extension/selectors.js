(() => {
  // Các selector mặc định chưa được xác minh (UNVERIFIED). Chúng có thể hỏng
  // khi TikTok hoặc Facebook thay đổi giao diện hoặc cấu trúc trang.
  const tiktok = {
    item: '[data-e2e="chat-message"]',
    name: '[data-e2e="message-owner-name"]',
    text: '.comment-text, [data-e2e="chat-message"] div:last-child',
  };

  const facebook = {
    item: [
      '[aria-label="Live chat" i] [role="article"]',
      '[aria-label="Live comments" i] [role="article"]',
      '[aria-label="Bình luận trực tiếp" i] [role="article"]',
      '[aria-label="Trò chuyện trực tiếp" i] [role="article"]',
    ].join(', '),
    name: 'a, strong',
    text: '[dir="auto"]',
  };

  globalThis.LiveMateSelectors = {
    tiktok,
    facebook,
    getConfig(platform, overrides) {
      const config = { ...{ tiktok, facebook }[platform] };
      for (const field of ['item', 'name', 'text']) {
        if (typeof overrides?.[field] === 'string' && overrides[field].trim()) {
          config[field] = overrides[field].trim();
        }
      }
      return config;
    },
  };
})();
