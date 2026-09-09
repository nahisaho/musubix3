/**
 * Backend-for-frontend boundary of the ecommerce-marketplace example.
 */

export interface OrderServiceResponse {
  status: number;
  decision: string;
}

export type OrderServiceClient = (request: {
  sku: string;
  quantity: number;
  amount: number;
  priorOrders: number;
}) => Promise<OrderServiceResponse>;

/** @id CODE-MARKETPLACE-005
 * @implements REQ-MARKETPLACE-005
 * @design DES-MARKETPLACE-005
 */
export async function submitOrder(
  client: OrderServiceClient,
  request: { sku: string; quantity: number; amount: number; priorOrders: number },
): Promise<OrderServiceResponse> {
  const response = await client(request);
  return { status: response.status, decision: response.decision };
}
