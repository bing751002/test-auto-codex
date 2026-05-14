# SPEC

## Implementation

Add a Node.js CommonJS CLI script at `tools/citiesocial-category-counts.cjs`.

The script should:

1. Define the five requested categories and collection handles.
2. Prefer Shopify's collection products JSON endpoint:
   `https://www.citiesocial.com/collections/<handle>/products.json?limit=250&page=<n>`.
3. Count product objects from each JSON page until a page returns fewer than the page limit or no products.
4. Fall back to collection HTML pages if JSON fetch/parsing fails:
   `https://www.citiesocial.com/collections/<handle>?page=<n>`.
5. In fallback mode, count unique `/products/<handle>` links across pages and stop when the page has no new products or no next-page signal.
6. Output JSON by default:

```json
{
  "source": "https://www.citiesocial.com/",
  "fetchedAt": "ISO timestamp",
  "categories": [
    { "name": "家居", "handle": "cate-home", "count": 123, "method": "json" }
  ]
}
```

7. Support `--table` for a readable console table.
8. Export pure helpers so tests can exercise counting with fake fetch implementations.

## Tests

Add `tests/citiesocial-category-counts.test.cjs`.

Cover:

- JSON endpoint pagination counts multiple pages and stops at a short page.
- Fallback HTML parsing deduplicates repeated product links.
- End-to-end category counting returns all five configured labels with their handles.

## Verification

Run the targeted new test file, then run the repository test command if unrelated untracked tests do not block it. If network is unavailable locally, document that live scrape was not executed in the sandbox and that the CLI will perform live fetches when run in a network-enabled environment.
