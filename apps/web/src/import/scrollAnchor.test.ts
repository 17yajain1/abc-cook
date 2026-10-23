import { describe, expect, it } from 'vitest'

import { anchorFrom, scrollTopFor } from './scrollAnchor'

const tops = { need: 300, steps: 900 }
const heights = { need: 600 }

describe('anchorFrom', () => {
  it('reads the header as top, with the pixel offset', () => {
    expect(anchorFrom(0, tops)).toEqual({ section: 'top', offset: 0 })
    expect(anchorFrom(120, tops)).toEqual({ section: 'top', offset: 120 })
  })

  it('reads What you need from its own top', () => {
    expect(anchorFrom(300, tops)).toEqual({ section: 'need', offset: 0 })
    expect(anchorFrom(450, tops)).toEqual({ section: 'need', offset: 150 })
  })

  it('reads Steps from its heading', () => {
    expect(anchorFrom(900, tops)).toEqual({ section: 'steps', offset: 0 })
    expect(anchorFrom(1500, tops)).toEqual({ section: 'steps', offset: 600 })
  })

  it('treats an over-scroll (negative) as the top of the page', () => {
    expect(anchorFrom(-40, tops)).toEqual({ section: 'top', offset: 0 })
  })
})

describe('scrollTopFor', () => {
  it('round trips on an identical layout', () => {
    for (const scrollTop of [0, 80, 299, 300, 450, 899]) {
      expect(scrollTopFor(anchorFrom(scrollTop, tops), tops, heights)).toBe(scrollTop)
    }
  })

  it('top keeps the pixel offset on a header of a different height, never past What you need', () => {
    expect(scrollTopFor({ section: 'top', offset: 120 }, { need: 500, steps: 1100 }, heights)).toBe(120)
    expect(scrollTopFor({ section: 'top', offset: 290 }, { need: 200, steps: 800 }, heights)).toBe(200)
  })

  it('need keeps the offset inside the section and clamps it to the section height', () => {
    expect(scrollTopFor({ section: 'need', offset: 150 }, { need: 500, steps: 1100 }, heights)).toBe(650)
    expect(scrollTopFor({ section: 'need', offset: 900 }, { need: 500, steps: 800 }, { need: 300 })).toBe(800)
  })

  it('steps lands on the Steps heading whatever the offset was', () => {
    expect(scrollTopFor({ section: 'steps', offset: 0 }, { need: 500, steps: 1100 }, heights)).toBe(1100)
    expect(scrollTopFor({ section: 'steps', offset: 480 }, { need: 500, steps: 1100 }, heights)).toBe(1100)
  })

  it('steps leaves room for the sticky bar, so the heading is not hidden under it', () => {
    expect(scrollTopFor({ section: 'steps', offset: 0 }, { need: 500, steps: 1100 }, heights, 70)).toBe(1030)
    expect(scrollTopFor({ section: 'steps', offset: 0 }, { need: 20, steps: 40 }, heights, 70)).toBe(0)
  })

  it('never returns a negative position', () => {
    expect(scrollTopFor({ section: 'top', offset: -5 }, tops, heights)).toBe(0)
    expect(scrollTopFor({ section: 'need', offset: -5 }, tops, { need: -10 })).toBe(300)
  })
})
