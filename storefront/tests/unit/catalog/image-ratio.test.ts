import {describe, expect, it} from 'vitest';
import {boxRatio} from '~/lib/shopify/image-ratio';

// REQ-COL-001, REQ-PDP-001: a product photo is shown whole, in a box with its own shape.
describe('boxRatio', () => {
  it.each([
    ['a square photo', {width: 1200, height: 1200}, 1],
    ['a landscape photo', {width: 1200, height: 886}, 1200 / 886],
    ['a very wide photo is held at 3:2', {width: 3000, height: 1000}, 1.5],
    ['a very tall photo is held at 3:4', {width: 500, height: 2000}, 0.75],
    ['no size known', {width: null, height: null}, 1],
    ['a zero or broken size', {width: 0, height: 100}, 1],
    ['no image', null, 1],
  ])('%s', (_name, image, expected) => {
    expect(boxRatio(image)).toBeCloseTo(expected, 5);
  });
});
