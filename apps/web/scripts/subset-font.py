"""Build public/fonts/archivo-var-subset.woff2 from the upstream Archivo variable font.

This is a **one-off asset build, not part of `make`.** The output is committed, so the
normal build and CI never need Python or network access. Re-run it only when the charset
or the type scale's axis ranges change (docs/DESIGN_SYSTEM.md § Type).

    npm install --no-save @fontsource-variable/archivo@5.3.0
    python -m venv .fontenv && .fontenv/Scripts/pip install "fonttools[woff]" brotli
    .fontenv/Scripts/python scripts/subset-font.py \
        node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2 \
        public/fonts/archivo-var-subset.woff2

Archivo is SIL OFL 1.1 (Omnibus-Type); the licence ships beside the font as
public/fonts/Archivo-LICENSE.txt.

Why subset at all: the upstream two-axis latin file is 88KB, over the 55KB budget
DESIGN_SYSTEM.md sets. Clamping the axes to the range the type scale actually uses and
cutting the charset to what the product renders brings it to ~49KB with both axes intact,
so the width axis — which carries the signage voice — survives.
"""

import sys

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC, OUT = sys.argv[1], sys.argv[2]

# Codepoints the product actually renders. Latin-1 accents cover "Sauté" and imported
# recipe titles; the fractions and degree sign cover ingredient quantities.
chars = set(range(0x0020, 0x007F))
chars |= {ord(c) for c in "àáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ"}
chars |= {ord(c) for c in "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝ"}
chars |= {0x00B0, 0x00BC, 0x00BD, 0x00BE}  # ° ¼ ½ ¾
chars |= {0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026}
chars |= {0x2192}  # the one arrow that encodes a dependency (DESIGN_SYSTEM.md)

font = TTFont(SRC)

# Clamp to the ranges the type scale uses: weights 300 (M3 timer) to 700, widths 88
# (condensed recipe title) to 112 (expanded stage label). Deltas outside are dead weight.
font = instancer.instantiateVariableFont(
    font, {"wght": (300, 700), "wdth": (88, 112)}, updateFontNames=False
)

options = Options()
options.flavor = "woff2"
options.layout_features = ["kern", "liga", "calt", "tnum", "ccmp", "locl", "mark", "mkmk"]
options.name_IDs = ["*"]
options.name_legacy = False
options.notdef_outline = False

subsetter = Subsetter(options=options)
subsetter.populate(unicodes=chars)
subsetter.subset(font)
font.flavor = "woff2"
font.save(OUT)

built = TTFont(OUT)
axes = [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in built["fvar"].axes]
print(f"axes: {axes}")
print(f"glyphs: {len(built.getGlyphOrder())} cmap: {len(built.getBestCmap())}")
