import { createServer } from 'node:http';
import { submitOrder, type OrderServiceResponse } from './submitOrder.js';

const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL ?? 'http://localhost:8080/orders';

async function callOrderService(request: {
  sku: string;
  quantity: number;
  amount: number;
  priorOrders: number;
}): Promise<OrderServiceResponse> {
  const response = await fetch(ORDER_SERVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const decision = (await response.json()) as { decision: string };
  return { status: response.status, decision: decision.decision };
}

createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/orders') {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const result = await submitOrder(callOrderService, body);
  res.writeHead(result.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}).listen(8084, () => console.log('bff listening on :8084'));
