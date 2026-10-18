# Request-dump diffs (offline, INR 0). Dumps: apps/api/scripts/dump_extraction_request.py

## before (origin/main) vs after-off (ABC_COOK_ADDED_STEPS off): must be empty

- stream-on-strict-on: 0 diff lines
- stream-on-strict-off: 0 diff lines
- stream-off-strict-on: 0 diff lines
- stream-off-strict-off: 0 diff lines

## after-off vs after-on: only messages[0].content (the prompt) and, with strict on, the origin schema property

### stream-on-strict-on: changed top-level keys = ['messages', 'response_format']; messages changed at index [0]
prompt diff (v7 -> v8, with the pasted schema line):
```diff
--- after-off
+++ after-on
@@ -1 +1 @@
-# ABC Cook — recipe extraction prompt (v7)
+# ABC Cook — recipe extraction prompt (v8)
@@ -13 +13,3 @@
-source's* recipe, not writing a recipe for this dish from memory.
+source's* recipe, not writing a recipe for this dish from memory. The one exception is a
+step the source skips (see "Steps the source skips" below): you may add it, but only
+marked `origin="added"`, so the cook is always told it did not come from the source.
@@ -77,0 +80,23 @@
+## Steps the source skips — `origin`
+
+Every step has an `origin`. It is `"source"` for every step the source describes (even
+when you reword it), and `"added"` only for a step you add yourself. This is the only
+exception to "never invent", and an added step is always shown to the cook as not coming
+from the source.
+
+- Add a step only when `method_grounded=true` and the source has at least one step of its
+  own. If the source has no method, return no steps at all: nothing is added to an
+  ingredients-only source.
+- Add one only when the dish cannot be made without it: a step the source does describe
+  uses something that no earlier step makes (for example, it adds a mixture that no
+  earlier step prepares). Place it before the first step that needs it.
+- Never change what a source step says to do, and never replace, remove or reorder one.
+  Added steps go between them.
+- An added step states no time and no temperature unless it repeats a value the source
+  itself gives, in the same units. Set `duration_stated=false`, `attention="hands_on"`
+  and `role="required"`.
+- An added step uses only ingredients the source lists. It never introduces a new
+  ingredient or quantity.
+- No garnish, serving suggestions or extras. If you are not sure a step is missing, do
+  not add it.
+
@@ -110,0 +136,9 @@
+- A substitution ("X can be replaced with Y", "use Y instead of X") is an alternative to
+  the step that uses X: emit it as its own step with `role="alternative"`, its
+  `role_cue` the substitution phrase, and `attach_to_step` the position of the step that
+  uses the ingredient being replaced. It is not a step of the cooking order.
+- Several ways to serve or eat the same dish ("two ways to eat these", "you can serve it
+  with …") are optional: emit each as its own step with `role="optional"`. The first one
+  quotes the phrase that introduces the ways as its `role_cue`; every later one quotes
+  that same introducing phrase and sets `attach_to_step` to the first serving way, not to
+  the step before it.
@@ -291 +325 @@
-{"$defs": {"NormalizedChapter": {"description": "A YouTube chapter marker. Grounded, but stage-level — never a node duration.\n\nSee design doc §0: a chapter delta measures how long the creator spent on screen,\nnot how long the cook will spend. Used only by `corroborate.py`.", "properties": {"label": {"description": "Chapter title, e.g. \"Marination\".", "title": "Label", "type": "string"}, "sta ...[line truncated]
+{"$defs": {"NormalizedChapter": {"description": "A YouTube chapter marker. Grounded, but stage-level — never a node duration.\n\nSee design doc §0: a chapter delta measures how long the creator spent on screen,\nnot how long the cook will spend. Used only by `corroborate.py`.", "properties": {"label": {"description": "Chapter title, e.g. \"Marination\".", "title": "Label", "type": "string"}, "sta ...[line truncated]
```
strict schema diff:
```diff
--- after-off
+++ after-on
@@ -272,0 +273,10 @@
+    },
+    "origin": {
+     "default": "source",
+     "description": "source for every step the source describes, even when you reword it. added only for a step you add because the source skips something the dish cannot be made without (see the prompt section \"Steps the source skips\"); the cook is shown it as added by the app, not by the source. Never added for a source with no method of its own.",
+     "enum": [
+      "source",
+      "added"
+     ],
+     "title": "Origin",
+     "type": "string"
@@ -328,0 +339 @@
+    "origin",
```
### stream-on-strict-off: changed top-level keys = ['messages']; messages changed at index [0]
### stream-off-strict-on: changed top-level keys = ['messages', 'response_format']; messages changed at index [0]
strict schema diff:
```diff
--- after-off
+++ after-on
@@ -272,0 +273,10 @@
+    },
+    "origin": {
+     "default": "source",
+     "description": "source for every step the source describes, even when you reword it. added only for a step you add because the source skips something the dish cannot be made without (see the prompt section \"Steps the source skips\"); the cook is shown it as added by the app, not by the source. Never added for a source with no method of its own.",
+     "enum": [
+      "source",
+      "added"
+     ],
+     "title": "Origin",
+     "type": "string"
@@ -328,0 +339 @@
+    "origin",
```
### stream-off-strict-off: changed top-level keys = ['messages']; messages changed at index [0]
