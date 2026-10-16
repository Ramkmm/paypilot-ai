
import { useCallback, useEffect, useState } from "react";
import "./App.css";

const API_URL = "http://127.0.0.1:8000";

function formatINR(value) {
  return Number(value).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}

function App() {
  const [product, setProduct] = useState("Office chairs");
  const [budget, setBudget] = useState("100000");
  const [quantity, setQuantity] = useState("20");

  const [result, setResult] = useState(null);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadRequests = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");

    try {
      const response = await fetch(
        `${API_URL}/api/purchase/requests`
      );

      const data = await response.json();

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

  async function getRecommendation(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch(
        `${API_URL}/api/purchase/recommend`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product: product.trim(),
            budget: Number(budget),
            quantity: Number(quantity),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Purchase request failed.");
      }

      setResult(data);
      await loadRequests();
    } catch (err) {
      setError(
        `${err.message} Check that FastAPI is running and MongoDB is connected.`
      );
    } finally {
      setLoading(false);
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
        <h1>Smarter purchasing.<br />Payments with control.</h1>
        <p>
          Describe what your business needs. Start with a budget,
          review the request, and keep purchasing decisions in your hands.
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
            onChange={(e) => setProduct(e.target.value)}
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
                onChange={(e) => setBudget(e.target.value)}
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
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
          </div>

          <button className="primary-button" disabled={loading}>
            {loading ? "Saving request..." : "Generate purchase request"}
            <span>→</span>
          </button>

          <p className="privacy-note">
            Demo only. This action does not initiate a payment.
          </p>
        </form>

        <section className="result-card">
          <div className="section-label">PURCHASE OVERVIEW</div>
          <h2>Your workspace</h2>

          {!result && !error && (
            <div className="empty-state">
              <div className="empty-icon">✳</div>
              <h3>Your next purchase starts here</h3>
              <p>
                Enter a product, budget, and quantity to generate
                your first purchase request.
              </p>
            </div>
          )}

          {loading && <p>Saving your request to MongoDB...</p>}

          {error && (
            <div className="error-message" role="alert">{error}</div>
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
                  : "Demo result only."}
                {" "}No live product search or AI recommendation has been performed.
              </p>

              <div className="approval-status">
                <span>Payment status</span>
                <strong>{result.payment_status || "Not started"}</strong>
              </div>

              {result.id && (
                <p className="muted">
                  Request ID: {result.id}
                </p>
              )}
            </div>
          )}
        </section>
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
                  <span>{request.payment_status || "Not started"}</span>
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
