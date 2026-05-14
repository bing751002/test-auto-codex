#!/usr/bin/env node
'use strict';

const SOURCE = 'https://www.citiesocial.com/';
const DEFAULT_PAGE_LIMIT = 250;

const CATEGORIES = [
  { name: '家居', handle: 'cate-home' },
  { name: '休閒娛樂', handle: 'cate-fun' },
  { name: '服飾配件', handle: 'cate-wear' },
  { name: '3C科技', handle: 'cate-tech' },
  { name: '美容與保健', handle: 'cate-beauty' }
];

function requireFetch(fetchImpl) {
  const resolved = fetchImpl || globalThis.fetch;
  if (typeof resolved !== 'function') {
    throw new Error('No fetch implementation is available.');
  }
  return resolved;
}

function collectionProductsJsonUrl(handle, page, pageLimit) {
  return `${SOURCE}collections/${encodeURIComponent(handle)}/products.json?limit=${pageLimit}&page=${page}`;
}

function collectionHtmlUrl(handle, page) {
  return `${SOURCE}collections/${encodeURIComponent(handle)}?page=${page}`;
}

async function countCollectionProductsJson({ fetchImpl, handle, pageLimit = DEFAULT_PAGE_LIMIT }) {
  const fetchFn = requireFetch(fetchImpl);
  let count = 0;

  for (let page = 1; ; page += 1) {
    const response = await fetchFn(collectionProductsJsonUrl(handle, page, pageLimit));
    if (!response || response.ok === false) {
      throw new Error(`JSON fetch failed for ${handle} page ${page}`);
    }

    const body = await response.json();
    if (!body || !Array.isArray(body.products)) {
      throw new Error(`JSON response for ${handle} page ${page} did not include products`);
    }

    count += body.products.length;
    if (body.products.length < pageLimit) {
      break;
    }
  }

  return { count, method: 'json' };
}

function decodeHtmlAttribute(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractProductPaths(html) {
  const products = new Set();
  const hrefPattern = /\bhref\s*=\s*(["'])(.*?)\1/gi;
  let match;

  while ((match = hrefPattern.exec(html)) !== null) {
    const href = decodeHtmlAttribute(match[2]);
    let url;
    try {
      url = new URL(href, SOURCE);
    } catch {
      continue;
    }

    if (url.hostname !== 'www.citiesocial.com') {
      continue;
    }

    const productMatch = url.pathname.match(/^\/products\/([^/]+)\/?$/);
    if (productMatch) {
      products.add(`/products/${productMatch[1]}`);
    }
  }

  return products;
}

function hasNextPageSignal(html, handle, page) {
  if (/\brel\s*=\s*(["'])[^"']*\bnext\b[^"']*\1/i.test(html)) {
    return true;
  }

  const nextPage = page + 1;
  const escapedHandle = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nextHrefPattern = new RegExp(
    `/collections/${escapedHandle}(?:[^"']*[?&]page=${nextPage}|\\?page=${nextPage})`,
    'i'
  );
  return nextHrefPattern.test(decodeHtmlAttribute(html));
}

async function countCollectionProductsHtml({ fetchImpl, handle }) {
  const fetchFn = requireFetch(fetchImpl);
  const seen = new Set();

  for (let page = 1; ; page += 1) {
    const response = await fetchFn(collectionHtmlUrl(handle, page));
    if (!response || response.ok === false) {
      throw new Error(`HTML fetch failed for ${handle} page ${page}`);
    }

    const html = await response.text();
    const before = seen.size;
    for (const productPath of extractProductPaths(html)) {
      seen.add(productPath);
    }

    const added = seen.size - before;
    if (added === 0 || !hasNextPageSignal(html, handle, page)) {
      break;
    }
  }

  return { count: seen.size, method: 'html' };
}

async function countCategory({ fetchImpl, category, pageLimit = DEFAULT_PAGE_LIMIT }) {
  try {
    const result = await countCollectionProductsJson({
      fetchImpl,
      handle: category.handle,
      pageLimit
    });
    return { ...category, ...result };
  } catch {
    const result = await countCollectionProductsHtml({
      fetchImpl,
      handle: category.handle
    });
    return { ...category, ...result };
  }
}

async function countAllCategories({
  fetchImpl,
  pageLimit = DEFAULT_PAGE_LIMIT,
  categories = CATEGORIES,
  fetchedAt = new Date().toISOString()
} = {}) {
  const results = [];
  for (const category of categories) {
    results.push(await countCategory({ fetchImpl, category, pageLimit }));
  }

  return {
    source: SOURCE,
    fetchedAt,
    categories: results
  };
}

function printTable(result) {
  const rows = result.categories.map((category) => ({
    name: category.name,
    handle: category.handle,
    count: category.count,
    method: category.method
  }));
  console.table(rows);
}

async function main(argv = process.argv.slice(2)) {
  const table = argv.includes('--table');
  const result = await countAllCategories();

  if (table) {
    printTable(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  CATEGORIES,
  DEFAULT_PAGE_LIMIT,
  SOURCE,
  collectionHtmlUrl,
  collectionProductsJsonUrl,
  countAllCategories,
  countCategory,
  countCollectionProductsHtml,
  countCollectionProductsJson,
  extractProductPaths,
  hasNextPageSignal
};
