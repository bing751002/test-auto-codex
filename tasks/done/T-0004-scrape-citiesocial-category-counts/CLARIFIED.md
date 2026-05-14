# T-0004 Scrape citiesocial category product counts

Source issue: bing751002/test-auto-codex#5

## Request

Scrape https://www.citiesocial.com/ and report how many products are in each of these five top-level categories:

- 家居
- 休閒娛樂
- 服飾配件
- 3C科技
- 美容與保健

## Confirmed category handles

The homepage category links map the requested labels to these collection handles:

- 家居: `cate-home`
- 休閒娛樂: `cate-fun`
- 服飾配件: `cate-wear`
- 3C科技: `cate-tech`
- 美容與保健: `cate-beauty`

## Acceptance

- Provide a reproducible scraper command in this repo.
- The command fetches current counts from citiesocial at runtime.
- The scraper counts products per requested top-level category, not variants.
- The implementation has automated tests for counting and fallback behavior without requiring live network access.
- Record verification results before commit/push.

## Constraints

- No third-party package is required unless the existing project already depends on it.
- Network access may be unavailable in the local sandbox, so tests must use fake fetch responses.
- Do not touch existing untracked user files `welcome.html` and `tests/static-welcome-page.test.cjs`.
