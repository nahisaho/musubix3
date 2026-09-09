import { describe, expect, it } from 'vitest';
import { submitOrder, type OrderServiceResponse } from './submitOrder.js';

/** @id TEST-MARKETPLACE-005
 * @verifies REQ-MARKETPLACE-005
 */
describe('TEST-MARKETPLACE-005 submitOrder', () => {
  it('forwards an accepted decision unchanged', async () => {
    const accepted: OrderServiceResponse = { status: 201, decision: 'accepted' };
    const client = async () => accepted;

    const result = await submitOrder(client, { sku: 'SKU-1', quantity: 1, amount: 100, priorOrders: 2 });

    expect(result).toEqual(accepted);
  });

  it('forwards a rejected decision unchanged', async () => {
    const rejected: OrderServiceResponse = { status: 409, decision: 'rejected' };
    const client = async () => rejected;

    const result = await submitOrder(client, { sku: 'SKU-1', quantity: 999, amount: 9000, priorOrders: 0 });

    expect(result).toEqual(rejected);
  });
});
