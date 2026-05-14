const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CATEGORIES,
  countAllCategories,
  countCollectionProductsHtml,
  countCollectionProductsJson
} = require('../tools/citiesocial-category-counts.cjs');

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body
  };
}

function htmlResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => body
  };
}

test('JSON endpoint pagination counts multiple pages and stops at a short page', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.endsWith('/collections/cate-home/products.json?limit=2&page=1')) {
      return jsonResponse({ products: [{ id: 1 }, { id: 2 }] });
    }
    if (url.endsWith('/collections/cate-home/products.json?limit=2&page=2')) {
      return jsonResponse({ products: [{ id: 3 }] });
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const result = await countCollectionProductsJson({
    fetchImpl,
    handle: 'cate-home',
    pageLimit: 2
  });

  assert.deepEqual(result, { count: 3, method: 'json' });
  assert.equal(urls.length, 2);
});

test('fallback HTML parsing deduplicates repeated product links', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/collections/cate-fun?page=1')) {
      return htmlResponse(`
        <a href="/products/speaker">Speaker</a>
        <a href="https://www.citiesocial.com/products/speaker?variant=1">Speaker repeat</a>
        <a href="/collections/cate-fun?page=2" rel="next">Next</a>
      `);
    }
    if (url.endsWith('/collections/cate-fun?page=2')) {
      return htmlResponse(`
        <a href="/products/speaker">Speaker again</a>
        <a href="/products/camera#details">Camera</a>
      `);
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const result = await countCollectionProductsHtml({
    fetchImpl,
    handle: 'cate-fun'
  });

  assert.deepEqual(result, { count: 2, method: 'html' });
});

test('end-to-end category counting returns all five configured labels with handles', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/products.json?limit=2&page=1')) {
      return jsonResponse({ products: [{ id: url }] });
    }
    if (url.includes('/products.json?limit=2&page=2')) {
      return jsonResponse({ products: [] });
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const result = await countAllCategories({ fetchImpl, pageLimit: 2 });

  assert.equal(result.source, 'https://www.citiesocial.com/');
  assert.match(result.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    result.categories.map(({ name, handle }) => ({ name, handle })),
    [
      { name: '家居', handle: 'cate-home' },
      { name: '休閒娛樂', handle: 'cate-fun' },
      { name: '服飾配件', handle: 'cate-wear' },
      { name: '3C科技', handle: 'cate-tech' },
      { name: '美容與保健', handle: 'cate-beauty' }
    ]
  );
  assert.deepEqual(
    CATEGORIES,
    result.categories.map(({ name, handle }) => ({ name, handle }))
  );
  assert.deepEqual(
    result.categories.map(({ count, method }) => ({ count, method })),
    [
      { count: 1, method: 'json' },
      { count: 1, method: 'json' },
      { count: 1, method: 'json' },
      { count: 1, method: 'json' },
      { count: 1, method: 'json' }
    ]
  );
});
