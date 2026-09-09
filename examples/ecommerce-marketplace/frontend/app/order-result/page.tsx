import { renderOrderSummary } from '../../src/renderOrderSummary.js';

export default async function OrderResultPage({
  searchParams,
}: {
  searchParams: Promise<{ decision?: string }>;
}) {
  const { decision } = await searchParams;
  return <p>{renderOrderSummary({ decision: decision ?? 'pending' })}</p>;
}
