# DB Sage Help screenshot workflow

Help images are intentionally produced in small batches. Capture a feature when
it is convenient, give the PNG a descriptive name, and save it directly in
`public/help/screenshots/`. The Help content can then be revised around the
image instead of forcing every feature into a predetermined screenshot plan.

## Naming images

Use a short lowercase, kebab-case filename that starts with the part of DB Sage
being shown. Add more detail from left to right:

- `table-overview.png`
- `table-toolbar-refresh.png`
- `table-toolbar-add-row.png`
- `table-column-menu-filter.png`
- `query-results-selector.png`
- `relations-cell-menu.png`

The name only needs to be clear enough to identify the feature. Do not add a
size, sequence number, `-source`, or `-final` suffix. If two captures show the
same control in different states, describe the state at the end, such as
`table-filter-empty.png` and `table-filter-active.png`.

When a batch is ready, provide the filenames and any context that is not obvious
from the images. Each image will be matched to the relevant article, and the
surrounding explanation, caption, and article structure can be adjusted as part
of placing it.

CapSage master documents may remain beside their exported PNGs while a batch is
being prepared and should be committed alongside the PNG exports. Help does not
render `.capsage` files; only the matching `.png` files are registered for
display.

## Dimensions and layout

There is no required width, height, or aspect ratio. Crop each image closely
enough that its subject is easy to recognize, while retaining enough nearby UI
to show where the feature lives.

Help reads the PNG's actual dimensions and never stretches a small image to the
article width. By default:

- focused images up to 720 pixels wide float beside the following text;
- larger images remain centered between paragraphs;
- images may scale down when the article is narrower than the PNG, but are never
  enlarged beyond their original physical pixel dimensions; Help accounts for
  Windows display scaling when converting PNG pixels to WebView CSS pixels;
- on narrow windows, floated images become centered blocks at their natural size
  or smaller;
- a specific image can be forced wide, left, or right when the automatic choice
  does not suit the article.

Captions remain attached to their images. A very small capture and its frame
stay at the image's natural width; the caption wraps within that width.

## Capture guidelines

1. Use the sanitized `Demo MySQL` connection and the
   `dbsage_screenshot_demo` database whenever the feature needs live data.
   Prefer the recurring `customers`, `orders`, `order_items`, `products`, and
   `event_log` tables so the help feels consistent.
2. Keep DB Sage at 100% zoom with its dark theme and default font rendering.
   `tools/help-screenshots/Set-CaptureWindow.ps1` remains available when a
   repeatable window size is useful, but using it is optional.
3. Use realistic invented data. Remove real hosts, usernames, database names,
   credentials, file paths, customer data, query text, and server identifiers.
4. Crop, annotate, or redact before placing the final lossless PNG in
   `public/help/screenshots/`. Help displays the delivered file as-is.
5. Avoid the mouse pointer, unrelated windows, notifications, and incidental
   tooltips or menus. Include a tooltip or open menu when it is the subject of
   the image.
6. For a modal, include enough of the app behind it to establish context. For a
   tiny button or menu item, include the nearby toolbar or panel rather than an
   isolated icon with no location cues.

## Delivery check

Open each finished PNG at 100% and inspect all four edges for accidental desktop,
terminal, toast, path, credential, or customer-data leakage. The PNGs in
`public/help/screenshots/` are the exact assets shipped with the app; there is no
conversion or derivative-generation step.
