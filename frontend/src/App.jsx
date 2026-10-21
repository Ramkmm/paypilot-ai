import { useCallback, useEffect, useState } from "react";
import "./App.css";

const API_URL = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").trim().replace(/\/$/, "");

async function readApiResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  throw new Error(text || `API request failed (${response.status}).`);
}

function formatINR(value) {
  return Number(value).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}

function App() {
  const [product, setProduct] = useState("Office chairs");
  const [budget, setBudget] = useState("10000");
  const [quantity, setQuantity] = useState("5");

  const [result, setResult] = useState(null);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [paypalLoading, setPaypalLoading] = useState(false);
  const [paypalMessage, setPaypalMessage] = useState("");
  const [paypalError, setPaypalError] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentResult, setAgentResult] = useState(null);
  const [agentError, setAgentError] = useState("");

  const loadRequests = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");

    try {
      const response = await fetch(`${API_URL}/api/purchase/requests`);
      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(data.detail || "Unable to load requests.");
      }

      setRequests(data.requests || []);
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    const pathname = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    // Support both legacy path redirects and root-query redirects from PayPal.
    // Root-query redirects avoid Vercel's 404 for a direct /paypal/return visit.
    const paypalAction = params.get("paypal");
    const isCancel = pathname === "/paypal/cancel" || paypalAction === "cancel";
    const isReturn = pathname === "/paypal/return" || paypalAction === "return";

    if (isCancel) {
      window.history.replaceState({}, "", "/");
      setPaypalMessage("PayPal checkout was cancelled. No payment was completed.");
      return;
    }

    if (!isReturn) {
      return;
    }

    const orderId = params.get("token") || params.get("order_id");
    window.history.replaceState({}, "", "/");

    if (!orderId) {
      setPaypalError("PayPal returned without an order ID.");
      return;
    }

    let ignore = false;

    async function capturePayment() {
      setPaypalLoading(true);
      setPaypalError("");
      setPaypalMessage("Verifying your PayPal Sandbox test payment...");

      try {
        const response = await fetch(`${API_URL}/api/paypal/capture-order`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: orderId }),
        });

        const data = await readApiResponse(response);

        if (!response.ok) {
          throw new Error(
            typeof data.detail === "string"
              ? data.detail
              : "Payment verification failed."
          );
        }

        if (ignore) return;

        if (data.payment_status === "completed") {
          setPaypalMessage(
            "Sandbox test payment verified: $1.00 USD. Your INR purchase budget has NOT been paid."
          );
        } else {
          setPaypalMessage(
            `PayPal response: ${data.payment_status || data.status || "Check payment status"}`
          );
        }

        await loadRequests();
      } catch (err) {
        if (!ignore) {
          setPaypalError(err.message);
          setPaypalMessage("");
        }
      } finally {
        if (!ignore) setPaypalLoading(false);
      }
    }

    capturePayment();

    return () => {
      ignore = true;
    };
  }, [loadRequests]);

  async function getRecommendation(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    setPaypalError("");
    setPaypalMessage("");

    try {
      const response = await fetch(`${API_URL}/api/purchase/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: product.trim(),
          budget: Number(budget),
          quantity: Number(quantity),
        }),
      });

      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(data.detail || "Purchase request failed.");
      }

      setResult(data);
      setAgentResult(null);
      setAgentError("");
      await loadRequests();
    } catch (err) {
      setError(
        `${err.message} Check that FastAPI is running and MongoDB is connected.`
      );
    } finally {
      setLoading(false);
    }
  }

  async function runAgentGrid() {
    if (!result?.id) {
      setAgentError("Generate and save a purchase request first.");
      return;
    }
    setAgentLoading(true);
    setAgentError("");
    setAgentResult(null);
    try {
      const response = await fetch(`${API_URL}/api/agents/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchase_request_id: result.id }),
      });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.detail || "Agent workflow failed.");
      setAgentResult(data);
    } catch (err) {
      setAgentError(`${err.message} Check that the FastAPI backend is running.`);
    } finally {
      setAgentLoading(false);
    }
  }

  async function startPayPalCheckout() {
    if (!result?.id) {
      setPaypalError("Generate and save a purchase request before starting the Sandbox test.");
      return;
    }

    setPaypalLoading(true);
    setPaypalError("");
    setPaypalMessage("");

    try {
      const response = await fetch(`${API_URL}/api/paypal/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchase_request_id: result.id }),
      });

      const data = await readApiResponse(response);

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Could not create PayPal order."
        );
      }

      if (!data.approval_url) {
        throw new Error("PayPal did not return an approval URL.");
      }

      window.location.assign(data.approval_url);
    } catch (err) {
      setPaypalError(err.message);
      setPaypalLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">P</span>
          PayPilot <span className="brand-ai">AI</span>
        </a>
        <span className="environment">DEMO ENVIRONMENT</span>
      </header>

      <section className="hero">
        <div className="eyebrow">AI-POWERED BUSINESS COMMERCE</div>
        <h1>
          Smarter purchasing.
          <br />
          Payments with control.
        </h1>
        <p>
          Describe what your business needs. Start with a budget, review the
          request, and keep purchasing decisions in your hands.
        </p>
      </section>

      <section className="workspace">
        <form className="purchase-card" onSubmit={getRecommendation}>
          <div className="section-label">PURCHASE ASSISTANT</div>
          <h2>What does your business need?</h2>

          <label htmlFor="product">Product or service</label>
          <input
            id="product"
            value={product}
            onChange={(event) => setProduct(event.target.value)}
            minLength={2}
            maxLength={150}
            required
          />

          <div className="form-grid">
            <div>
              <label htmlFor="budget">Total budget (₹)</label>
              <input
                id="budget"
                type="number"
                min="1"
                max="100000000"
                step="0.01"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="quantity">Quantity</label>
              <input
                id="quantity"
                type="number"
                min="1"
                max="100000"
                step="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                required
              />
            </div>
          </div>

          <button className="primary-button" disabled={loading}>
            {loading ? "Saving request..." : "Generate purchase request"}
            <span>→</span>
          </button>

          <p className="privacy-note">
            Saving a purchase request does not initiate a payment.
          </p>

          <div className="paypal-test-section">
            <button
              type="button"
              className="primary-button"
              onClick={startPayPalCheckout}
              disabled={paypalLoading || !result?.id}
              title={!result?.id ? "Generate a purchase request first" : "Start Sandbox test checkout"}
            >
              {paypalLoading ? "Processing..." : "Run $1.00 PayPal Sandbox Test"}
              <span>→</span>
            </button>
            <p className="privacy-note">
              Sandbox test only. The $1.00 USD test is separate from your INR
              purchase budget and does not pay for the goods.
            </p>
          </div>

          {paypalMessage && <p role="status">{paypalMessage}</p>}
          {paypalError && (
            <p className="error-message" role="alert">
              {paypalError}
            </p>
          )}
        </form>

        <section className="result-card">
          <div className="section-label">PURCHASE OVERVIEW</div>
          <h2>Your workspace</h2>

          {!result && !error && (
            <div className="empty-state">
              <div className="empty-icon">✳</div>
              <h3>Your next purchase starts here</h3>
              <p>
                Enter a product, budget, and quantity to generate your first
                purchase request.
              </p>
            </div>
          )}

          {loading && <p>Saving your request to MongoDB...</p>}
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}

          {result && (
            <div className="result-content">
              <span className="status-pill">Request prepared</span>
              <h3>{result.product_requested}</h3>
              <p className="muted">
                {result.quantity.toLocaleString("en-IN")} units requested
              </p>

              <div className="metric">
                <span>Total budget</span>
                <strong>{formatINR(result.total_budget)}</strong>
              </div>
              <div className="metric">
                <span>Budget per item</span>
                <strong>{formatINR(result.budget_per_item)}</strong>
              </div>

              <div className="recommendation">
                <strong>Next step</strong>
                <p>{result.recommendation}</p>
              </div>

              <p className="demo-notice">
                {result.saved_to_database
                  ? "Purchase request saved successfully to MongoDB Atlas."
                  : "Demo result only."}{" "}
                No live product search or AI recommendation has been performed.
              </p>

              <div className="approval-status">
                <span>Actual purchase payment</span>
                <strong>{result.payment_status || "not_started"}</strong>
              </div>

              <div className="approval-status">
                <span>Sandbox test payment</span>
                <strong>
                  {result.sandbox_test_payment_status || "not_started"}
                </strong>
              </div>

              <p className="privacy-note">
                A completed $1.00 Sandbox test does not pay the ₹ purchase budget.
              </p>

              {result.id && (
                <p className="muted">Request ID: {result.id}</p>
              )}
            </div>
          )}
        </section>
      </section>

      <section className="history-section agent-section">
        <div className="history-heading">
          <div>
            <div className="section-label">MULTI-AGENT WORKFLOW</div>
            <h2>AI Agent Grid</h2>
            <p className="muted">Run a coordinated purchasing analysis on your saved request.</p>
          </div>
          <button type="button" className="refresh-button" onClick={runAgentGrid} disabled={!result?.id || agentLoading}>
            {agentLoading ? "Agents working..." : "Run Agent Grid"}
          </button>
        </div>
        <div className="request-list agent-grid">
          {[
            ["Research Agent", "Supplier research plan and comparison checklist"],
            ["Budget Agent", "Per-unit budget and budget guardrails"],
            ["Risk Agent", "Missing information and procurement risks"],
            ["Procurement Agent", "Human approval and next-step recommendation"],
          ].map(([name, description]) => (
            <article className="saved-request agent-card" key={name}>
              <h3>{name}</h3><p className="muted">{description}</p>
              <span className="status-pill">{agentResult ? "Analysis complete" : "Ready to run"}</span>
            </article>
          ))}
        </div>
        <p className="privacy-note">
          Demo mode: supplier offers are synthetic examples, not live Amazon,
          Flipkart, or Google Shopping listings. No supplier API or external LLM
          is connected yet.
        </p>
        {agentError && <p className="error-message" role="alert">{agentError}</p>}
        {agentResult && (
          <div className="recommendation agent-output">
            <div className="demo-data-banner">
              <strong>{agentResult.data_source_label || "DEMO DATA"}</strong>
              <span>Verify real prices and availability before buying.</span>
            </div>
            <strong>Agent workflow results</strong>
            <p>{agentResult.summary}</p>

            <div className="agent-status-list">
              {(agentResult.agents || []).map((agent) => (
                <article className="agent-status-row" key={agent.id || agent.name}>
                  <div>
                    <strong>{agent.name}</strong>
                    <p>{agent.result}</p>
                  </div>
                  <span className="status-pill">{agent.status || "completed"}</span>
                </article>
              ))}
            </div>

            <h3>Supplier comparison</h3>
            <p className="muted">Illustrative totals for {result?.quantity || 0} unit(s). Delivery, tax, stock, and seller terms are not verified.</p>
            <div className="supplier-table-wrap">
              <table className="supplier-table">
                <thead>
                  <tr>
                    <th>Demo source</th>
                    <th>Unit price</th>
                    <th>Qty</th>
                    <th>Estimated total</th>
                    <th>Budget check</th>
                  </tr>
                </thead>
                <tbody>
                  {(agentResult.offers || []).map((offer) => (
                    <tr key={offer.supplier}>
                      <td>
                        <strong>{offer.supplier}</strong>
                        <span className="table-subtitle">{offer.marketplace_style}</span>
                      </td>
                      <td>{formatINR(offer.unit_price)}</td>
                      <td>{offer.quantity}</td>
                      <td>
                        <strong>{formatINR(offer.estimated_total)}</strong>
                        <span className="table-subtitle">{offer.delivery_days}</span>
                      </td>
                      <td>
                        <span className={`status-pill ${offer.within_budget ? "status-ok" : "status-warning"}`}>
                          {offer.within_budget ? `Under by ${formatINR(offer.budget_remaining)}` : `Over by ${formatINR(Math.abs(offer.budget_remaining))}`}
                        </span>
                        {offer.recommended && <span className="recommended-label">Recommended demo</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="recommendation supplier-recommendation">
              <strong>Procurement Agent recommendation</strong>
              <p>{agentResult.recommendation}</p>
            </div>

            <ul>{(agentResult.checklist || []).map((item, index) => <li key={index}>{item}</li>)}</ul>
            <p className="muted">Workflow: {agentResult.workflow_status} · Request: {agentResult.purchase_request_id}</p>
            <p className="privacy-note">
              Buyer approval is required. The separate $1.00 PayPal Sandbox test only
              demonstrates payment integration; it does not purchase these items.
            </p>
          </div>
        )}
      </section>

      <section className="history-section">
        <div className="history-heading">
          <div>
            <div className="section-label">MONGODB ATLAS</div>
            <h2>Saved purchase requests</h2>
          </div>
          <button
            type="button"
            className="refresh-button"
            onClick={loadRequests}
            disabled={historyLoading}
          >
            {historyLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {historyError && (
          <p className="error-message" role="alert">{historyError}</p>
        )}

        {!historyError && requests.length === 0 && !historyLoading && (
          <p className="muted">No saved requests found.</p>
        )}

        {requests.length > 0 && (
          <div className="request-list">
            {requests.map((request) => (
              <article className="saved-request" key={request.id}>
                <div>
                  <h3>{request.product}</h3>
                  <p className="muted">
                    {request.quantity} units · {request.id}
                  </p>
                </div>
                <div className="saved-request-details">
                  <strong>{formatINR(request.budget)}</strong>
                  <span>
                    Purchase: {request.payment_status || "not_started"}
                  </span>
                  <span>
                    Sandbox test: {request.sandbox_test_payment_status || "not_started"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer>
        <span>PayPilot AI</span>
        <span>AI-assisted commerce · User-controlled payments</span>
      </footer>
    </main>
  );
}

export default App;
