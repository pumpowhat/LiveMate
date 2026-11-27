// @vitest-environment node
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
let dom;

function load(html = '') {
  dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.eval(read('../selectors.js'));
  dom.window.eval(read('../extract.js'));
  return {
    document: dom.window.document,
    selectors: dom.window.LiveMateSelectors,
    ...dom.window.LiveMateExtract,
  };
}

afterEach(() => dom?.window.close());

describe('detectPlatform', () => {
  it.each([
    ['https://www.tiktok.com/@shop/live', 'tiktok'],
    ['https://tiktok.com/@shop/live', 'tiktok'],
    ['https://www.facebook.com/watch/live/', 'facebook'],
    ['https://m.facebook.com/live/', 'facebook'],
    ['https://notfacebook.com/live', null],
    ['https://tiktok.com.example.org/', null],
  ])('maps %s to %s', (url, platform) => {
    const { detectPlatform } = load();
    expect(detectPlatform(new URL(url))).toBe(platform);
  });
});

describe('extractComment', () => {
  it.each([
    ['tiktok', [
      { buyerName: 'Ngọc Mai', text: 'Còn màu đỏ không?' },
      { buyerName: 'Minh', text: 'Lấy hai cái' },
      null,
    ]],
    ['facebook', [
      { buyerName: 'Mai Trần', text: 'Còn hàng màu xanh?' },
      { buyerName: 'An', text: 'Cho mình một cái' },
      null,
    ]],
  ])('extracts names and text from the %s fixture', (platform, expected) => {
    const { document, selectors, findItems, extractComment } =
      load(read(`./fixtures/${platform}.html`));
    const items = findItems(document, selectors[platform]);
    expect(items.map((item) => extractComment(item, selectors[platform]))).toEqual(expected);
    expect(findItems(items[0], selectors[platform])).toEqual([items[0]]);
  });

  it.each(['đã tham gia', 'joined', 'shared', 'liked', 'đã thích', 'đã chia sẻ'])(
    'ignores the system row "%s"',
    (status) => {
      const { document, selectors, extractComment } = load(
        `<div><b data-e2e="message-owner-name">An</b><div class="comment-text">${status}</div></div>`,
      );
      expect(extractComment(document.body.firstElementChild, selectors.tiktok)).toBeNull();
    },
  );

  it('uses the overridden item, name and text selectors', () => {
    const { document, selectors, findItems, extractComment } = load(`
      <p class="row"><b class="buyer"> Lan </b><span class="message">Lan —  áo   tím</span></p>
      <p class="row"><b class="buyer"> Lan </b><span class="message">Lan:</span></p>
      <p><b class="buyer"> Khách </b><span class="message">Ngoài khung</span></p>
    `);
    const overrides = { item: '.row', name: '.buyer', text: '.message' };
    const config = selectors.getConfig('tiktok', overrides);
    expect(findItems(document.body, config).map((row) => extractComment(row, config))).toEqual([
      { buyerName: 'Lan', text: 'áo tím' },
      null,
    ]);
    expect(selectors.getConfig('tiktok', { item: '.row' })).toEqual({
      ...selectors.tiktok, item: '.row',
    });
  });

  it('preserves a word that starts with the same letters as the name', () => {
    const { document, selectors, extractComment } = load(`
      <div><b data-e2e="message-owner-name">An</b><span class="comment-text">Anh lấy một cái</span></div>
    `);
    expect(extractComment(document.body.firstElementChild, selectors.tiktok)).toEqual({
      buyerName: 'An', text: 'Anh lấy một cái',
    });
  });
});
