(() => {
  const normalize = (value) => value.replace(/\s+/gu, ' ').trim();
  const systemMessage = /^(?:đã tham gia|joined|shared|liked|đã thích|đã chia sẻ)(?=$|[\s.!…])/iu;

  function detectPlatform(location) {
    const host = location?.hostname?.toLowerCase();
    if (!host) return null;
    for (const platform of ['tiktok', 'facebook']) {
      if (host === platform + '.com' || host.endsWith('.' + platform + '.com')) return platform;
    }
    return null;
  }

  function stripNamePrefix(text, name) {
    if (!text.startsWith(name)) return text;
    const remaining = text.slice(name.length);
    if (remaining && !/^[\s:：,·\-–—]/u.test(remaining)) return text;
    return remaining.replace(/^[\s:：,·\-–—]+/u, '');
  }

  function textWithoutName(node, nameNode) {
    if (!node.contains(nameNode)) return node.textContent;
    const range = node.ownerDocument.createRange();
    range.selectNodeContents(node);
    range.setStartAfter(nameNode);
    return range.toString();
  }

  function matchingText(row, selector, nameNode) {
    const matches = new Set(row.querySelectorAll(selector));
    const parts = [];
    for (const node of matches) {
      if (nameNode.contains(node)) continue;
      let parent = node.parentElement;
      while (parent !== row && !matches.has(parent)) parent = parent.parentElement;
      if (parent === row) parts.push(textWithoutName(node, nameNode));
    }
    return normalize(parts.join(' '));
  }

  function extractComment(node, config) {
    try {
      const nameNode = Array.from(node.querySelectorAll(config.name))
        .find((candidate) => normalize(candidate.textContent));
      if (!nameNode) return null;
      const buyerName = normalize(nameNode.textContent);
      const text = stripNamePrefix(matchingText(node, config.text, nameNode), buyerName);
      return text && !systemMessage.test(text) ? { buyerName, text } : null;
    } catch (error) {
      if (error.name === 'SyntaxError') return null;
      throw error;
    }
  }

  function findItems(root, config) {
    if (!root.querySelectorAll) return [];
    try {
      const items = Array.from(root.querySelectorAll(config.item));
      if (root.matches?.(config.item)) items.unshift(root);
      return items;
    } catch (error) {
      if (error.name === 'SyntaxError') return [];
      throw error;
    }
  }

  globalThis.LiveMateExtract = { detectPlatform, extractComment, findItems };
})();
