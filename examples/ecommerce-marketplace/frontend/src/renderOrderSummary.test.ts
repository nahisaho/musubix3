import { describe, expect, it } from 'vitest';
import { renderOrderSummary } from './renderOrderSummary.js';

/** @id TEST-MARKETPLACE-006
 * @verifies REQ-MARKETPLACE-006
 */
describe('TEST-MARKETPLACE-006 renderOrderSummary', () => {
  it('renders the accepted decision text unmodified', () => {
    const output = renderOrderSummary({ decision: 'accepted' });
    expect(output).toBe('Order result: accepted');
  });
});
