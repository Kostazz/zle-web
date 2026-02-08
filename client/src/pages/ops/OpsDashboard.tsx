import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";

type OpsSummary = {
  ok: boolean;
  counts: {
    pending?: number;
    confirmed?: number;
    cancelled?: number;
    paid?: number;
    unpaid?: number;
    cod?: number;
    card?: number;
    stockDeducted?: number;
    total?: number;
  };
};

type OpsOrderRow = {
  id: string;
  createdAt: string;
  status: string;
  paymentStatus: string | null;
  paymentMethod: string | null;
  total: number;
  stockDeductedAt: string | null;
  customerName: string;
  customerEmail: string;
};

type OpsOrdersResponse = {
  ok: boolean;
  limit: number;
  offset: number;
  items: OpsOrderRow[];
};

type OpsOrderDetail = {
  ok: boolean;
  order: OpsOrderRow & {
    customerAddress: string;
    customerCity: string;
    customerZip: string;
    paymentIntentId?: string | null;
  };
  parsedItems: {
    items: Array<{ name?: string; productId?: string; quantity?: number; size?: string }>;
    shippingMethod?: string | null;
    shippingLabel?: string | null;
    subtotalCzk?: number | null;
    shippingCzk?: number | null;
    codCzk?: number | null;
    totalCzk?: number | null;
  };
};

const STORAGE_KEY = "zle_ops_token";

export default function OpsDashboard() {
  const [token, setToken] = useState("");
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [orders, setOrders] = useState<OpsOrderRow[]>([]);
  const [detail, setDetail] = useState<OpsOrderDetail | null>(null);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState("createdAt_desc");
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) || "";
    setToken(saved);
  }, []);

  useEffect(() => {
    if (!token) return;
    localStorage.setItem(STORAGE_KEY, token);
  }, [token]);

  const headers = useMemo(() => {
    return token ? { "x-ops-token": token } : {};
  }, [token]);

  const fetchSummary = async () => {
    if (!token) return;
    const response = await fetch("/api/ops/summary", { headers });
    const data = (await response.json()) as OpsSummary;
    setSummary(data);
  };

  const fetchOrders = async () => {
    if (!token) return;
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    params.set("sort", sort);
    if (status) params.set("status", status);
    if (paymentStatus) params.set("paymentStatus", paymentStatus);
    if (paymentMethod) params.set("paymentMethod", paymentMethod);
    if (q.trim()) params.set("q", q.trim());

    const response = await fetch(`/api/ops/orders?${params.toString()}`, { headers });
    const data = (await response.json()) as OpsOrdersResponse;
    setOrders(data.items || []);
  };

  const fetchDetail = async (id: string) => {
    if (!token) return;
    const response = await fetch(`/api/ops/orders/${encodeURIComponent(id)}`, { headers });
    const data = (await response.json()) as OpsOrderDetail;
    setDetail(data);
  };

  useEffect(() => {
    let active = true;
    if (!token) return;
    setLoading(true);
    Promise.all([fetchSummary(), fetchOrders()])
      .catch(() => null)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, limit, offset, sort, status, paymentStatus, paymentMethod, q]);

  const handleSelectOrder = (id: string) => {
    fetchDetail(id).catch(() => null);
  };

  return (
    <Layout>
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="border border-white/15 bg-black/40 p-5">
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1">
                  <div className="text-xs uppercase tracking-widest text-white/50">OPS Token</div>
                  <input
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="x-ops-token"
                    className="w-full mt-2 bg-black/60 border border-white/15 rounded px-3 py-2 text-sm text-white"
                  />
                </div>
                <div className="text-xs text-white/50">
                  {loading ? "Načítám…" : token ? "Token uložen" : "Zadej token"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Pending", value: summary?.counts?.pending ?? "-" },
                { label: "Confirmed", value: summary?.counts?.confirmed ?? "-" },
                { label: "Paid", value: summary?.counts?.paid ?? "-" },
                { label: "Unpaid", value: summary?.counts?.unpaid ?? "-" },
                { label: "COD", value: summary?.counts?.cod ?? "-" },
                { label: "Stock Deducted", value: summary?.counts?.stockDeducted ?? "-" },
              ].map((card) => (
                <div key={card.label} className="border border-white/10 bg-black/30 p-4">
                  <div className="text-xs uppercase tracking-widest text-white/40">{card.label}</div>
                  <div className="text-2xl font-semibold text-white mt-2">{card.value}</div>
                </div>
              ))}
            </div>

            <div className="border border-white/15 bg-black/40 p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                  className="bg-black/60 border border-white/15 rounded px-3 py-2 text-sm text-white"
                >
                  <option value="createdAt_desc">Created ↓</option>
                  <option value="createdAt_asc">Created ↑</option>
                  <option value="total_desc">Total ↓</option>
                </select>
                <input
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  placeholder="Status"
                  className="bg-black/60 border border-white/15 rounded px-3 py-2 text-sm text-white"
                />
                <input
                  value={paymentStatus}
                  onChange={(event) => setPaymentStatus(event.target.value)}
                  placeholder="Payment Status"
                  className="bg-black/60 border border-white/15 rounded px-3 py-2 text-sm text-white"
                />
                <input
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                  placeholder="Payment Method"
                  className="bg-black/60 border border-white/15 rounded px-3 py-2 text-sm text-white"
                />
                <input
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder="Search"
                  className="bg-black/60 border border-white/15 rounded px-3 py-2 text-sm text-white"
                />
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  className="border-white/20 text-white"
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  className="border-white/20 text-white"
                  onClick={() => setOffset(offset + limit)}
                >
                  Next
                </Button>
                <div className="text-xs text-white/50">offset: {offset}</div>
                <select
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value))}
                  className="bg-black/60 border border-white/15 rounded px-2 py-1 text-xs text-white"
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>

              <div className="overflow-auto border border-white/10">
                <table className="w-full text-sm text-white/80">
                  <thead className="bg-black/70 text-xs uppercase tracking-widest text-white/40">
                    <tr>
                      <th className="px-3 py-2 text-left">ID</th>
                      <th className="px-3 py-2 text-left">Customer</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Payment</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((row) => (
                      <tr
                        key={row.id}
                        className="border-t border-white/10 hover:bg-white/5 cursor-pointer"
                        onClick={() => handleSelectOrder(row.id)}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{row.id.slice(0, 10)}</td>
                        <td className="px-3 py-2">
                          <div>{row.customerName}</div>
                          <div className="text-xs text-white/40">{row.customerEmail}</div>
                        </td>
                        <td className="px-3 py-2">{row.status}</td>
                        <td className="px-3 py-2">
                          {row.paymentStatus} / {row.paymentMethod}
                        </td>
                        <td className="px-3 py-2 text-right">{row.total} Kč</td>
                      </tr>
                    ))}
                    {orders.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-white/40">
                          No orders
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {detail?.order && (
              <div className="border border-white/15 bg-black/40 p-5">
                <div className="text-xs uppercase tracking-widest text-white/40 mb-4">Detail</div>
                <div className="grid md:grid-cols-2 gap-6 text-sm text-white/80">
                  <div>
                    <div>ID: {detail.order.id}</div>
                    <div>Status: {detail.order.status}</div>
                    <div>
                      Payment: {detail.order.paymentStatus} / {detail.order.paymentMethod}
                    </div>
                    <div>Shipping: {detail.parsedItems?.shippingLabel ?? "-"}</div>
                    <div>Total: {detail.parsedItems?.totalCzk ?? detail.order.total} Kč</div>
                  </div>
                  <div>
                    <div>{detail.order.customerName}</div>
                    <div>{detail.order.customerEmail}</div>
                    <div>
                      {detail.order.customerAddress}, {detail.order.customerCity} {detail.order.customerZip}
                    </div>
                    <div>PaymentIntent: {detail.order.paymentIntentId ?? "-"}</div>
                    <div>StockDeductedAt: {detail.order.stockDeductedAt ?? "-"}</div>
                  </div>
                </div>

                <div className="mt-4 border-t border-white/10 pt-4">
                  <div className="text-xs uppercase tracking-widest text-white/40 mb-2">Items</div>
                  <ul className="space-y-2 text-sm text-white/80">
                    {(detail.parsedItems?.items || []).map((item, idx) => (
                      <li key={`${item.productId || "item"}-${idx}`}>
                        {item.name || item.productId || "Produkt"} {item.size ? `(${item.size})` : ""} ×{" "}
                        {item.quantity ?? 0}
                      </li>
                    ))}
                    {detail.parsedItems?.items?.length === 0 && <li>—</li>}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </Layout>
  );
}
