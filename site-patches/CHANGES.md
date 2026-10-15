# Changes to blog.js

Two changes, both logic-only — no CSS or markup changed, no existing behavior
removed except the one handler that's now superseded.

## 1. Removed the hardcoded `extra` Load More data (~40 lines)

The original `#loadMore` button appended 4 fixed posts from an `extra` array
baked into the file. `blog-live.js` now owns that button and fetches real,
paginated posts from the engine's API instead. Leaving the old handler in
place would mean **two** click listeners firing on every click — the old one
appending fake posts, the new one appending real ones.

## 2. Escaped article data before building the full-article tab (XSS fix)

This bug exists in your original file today, independent of the engine —
worth fixing either way. `generateFullArticleHTML()` builds a full HTML
document from a card's text and opens it with `document.write()`. That text
was interpolated **unescaped**. A card whose title contained something like
`<img src=x onerror=alert(1)>` would execute that markup in the new tab,
which runs on your site's own origin.

This mattered only in theory while every title was hand-written in this file.
Once titles and descriptions come from the CMS editor, it becomes a real
stored-XSS path — an author (or anyone with access to the editor) can put
arbitrary HTML in a title. Every place `getCardArticleData`,
`getFeaturedArticleData`, and `getTrendArticleData` extract text from the DOM,
it's now passed through a small `esc()` helper before use, matching what
`blog-live.js` already does when it renders cards in the first place. The
`article-content`'s static scaffold HTML (the `<h2>`, `<ul><li>` filler text)
is untouched — only the variable parts are escaped.

Nothing about the article tab's appearance changes for any post that doesn't
contain HTML special characters, which is every post you have today.
