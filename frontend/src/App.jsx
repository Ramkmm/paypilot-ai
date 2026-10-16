
import { useState } from "react";
import "./App.css";

const API_URL = "http://127.0.0.1:8000";

function App() {
  const [product, setProduct] = useState("Office chairs");
  const [budget, setBudget] = useState("100000");
  const [quantity, setQuantity] = useState("20");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
            product,
            budget: Number(budget),
            quantity: Number(quantity),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Request failed.");
      }

      setResult(data);
    } catch (err) {
      setError(
        `${err.message} Check that the FastAPI backend is running.`
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
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
          </div>

          <button className="primary-button" disabled={loading}>
            {loading ? "Checking request..." : "Generate purchase request"}
            <span>→</span>
          </button>

          <p className="privacy-note">
            Demo only. No payment is initiated by this action.
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

          {loading && <p>Connecting to PayPilot AI API...</p>}

          {error && <div className="error-message">{error}</div>}

          {result && (
            <div className="result-content">
              <span className="status-pill">Request prepared</span>
              <h3>{result.product_requested}</h3>
              <p className="muted">
                {result.quantity.toLocaleString()} units requested
              </p>

              <div className="metric">
                <span>Total budget</span>
                <strong>
                  ₹{result.total_budget.toLocaleString("en-IN")}
                </strong>
              </div>

              <div className="metric">
                <span>Budget per item</span>
                <strong>
                  ₹{result.budget_per_item.toLocaleString("en-IN")}
                </strong>
              </div>

              <div className="recommendation">
                <strong>Next step</strong>
                <p>{result.recommendation}</p>
              </div>

              <p className="demo-notice">
                Demo calculation only. No live product search or AI
                recommendation has been performed yet.
              </p>

              <div className="approval-status">
                <span>Payment status</span>
                <strong>Not started</strong>
              </div>
            </div>
          )}
        </section>
      </section>

      <footer>
        <span>PayPilot AI</span>
        <span>AI-assisted commerce · User-controlled payments</span>
      </footer>
    </main>
  );
}

export default App;
